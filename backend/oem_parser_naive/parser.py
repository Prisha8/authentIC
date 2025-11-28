# datasheet_parser.py

from __future__ import annotations
from dataclasses import dataclass, asdict
from typing import List, Dict, Optional, Any, Tuple
import pdfplumber
import re
import json
import math
import os


# ---------- Data models ----------

@dataclass
class ICIdentity:
    manufacturer: str
    base_part: str
    specific_part: str
    family: Optional[str]
    package: str
    pin_count: int


@dataclass
class MechanicalSpecs:
    body_length_nom_mm: Optional[float] = None
    body_width_nom_mm: Optional[float] = None
    body_height_max_mm: Optional[float] = None
    length_width_ratio: Optional[float] = None
    height_width_ratio: Optional[float] = None


@dataclass
class PinInfo:
    pin_count: int
    gnd_pins: List[int]
    vcc_pins: List[int]


@dataclass
class MarkingInfo:
    allowed_strings: List[str]


@dataclass
class DatasheetSpec:
    ic_identity: ICIdentity
    mechanical: MechanicalSpecs
    pins: PinInfo
    markings: MarkingInfo
    source_metadata: Dict[str, Any]


# ---------- PDF helpers ----------

def extract_full_text(pdf_path: str) -> str:
    with pdfplumber.open(pdf_path) as pdf:
        texts = []
        for page in pdf.pages:
            t = page.extract_text() or ""
            texts.append(t)
        return "\n".join(texts)


def extract_page_texts(pdf_path: str) -> List[str]:
    with pdfplumber.open(pdf_path) as pdf:
        return [(page.extract_text() or "") for page in pdf.pages]


# ---------- Device Information table parsing ----------

DEVICE_INFO_ROW_RE = re.compile(
    r'(SN[0-9A-Z]+)\s+([A-Z0-9]+)\s*\((\d+)\)\s+([\d.]+)\s*mm\s*[×x]\s*([\d.]+)\s*mm'
)

def parse_device_info_table(full_text: str) -> List[Dict[str, Any]]:
    """
    Parse the 'Device Information' table from the PDF text.

    Example row in this datasheet:
    SN74HC04D SOIC (14) 8.70 mm × 3.90 mm
    """
    rows = []
    for m in DEVICE_INFO_ROW_RE.finditer(full_text):
        part, pkg, pins, length, width = m.groups()
        rows.append({
            "part_number": part,
            "package": pkg,         # e.g. SOIC
            "pin_count": int(pins), # e.g. 14
            "length_mm": float(length),
            "width_mm": float(width),
        })
    return rows


def choose_package_for_part(
    part_number: str,
    device_rows: List[Dict[str, Any]]
) -> Dict[str, Any]:
    """
    Given a specific part number like 'SN74HC04D', choose the best matching row.
    Fallback logic:
      - exact match
      - match by base part (e.g., SN74HC04) -> first row
      - if all fails, raise.
    """
    if not device_rows:
        raise ValueError("No Device Information rows parsed from datasheet")

    # Exact match
    for row in device_rows:
        if row["part_number"].upper() == part_number.upper():
            return row

    # Try base-part match
    base = base_part_from_specific(part_number)
    base_rows = [r for r in device_rows if r["part_number"].upper().startswith(base.upper())]
    if base_rows:
        return base_rows[0]

    # Fallback: just take the first
    return device_rows[0]


# ---------- Mechanical / package outline ----------

def extract_max_height_for_package(full_text: str, package: str) -> Optional[float]:
    """
    For many TI parts, mechanical outline includes lines like:
      D0014A SOIC - 1.75 mm max height

    We'll look for '<package> - X mm max height'.
    """
    # E.g. "SOIC - 1.75 mm max height"
    pattern = rf'{re.escape(package)}\s*-\s*([\d.]+)\s*mm\s*max height'
    m = re.search(pattern, full_text, flags=re.IGNORECASE)
    if not m:
        return None
    return float(m.group(1))


# ---------- Pin info parsing ----------

def extract_pin_info(page_texts: List[str], part_pin_count: int) -> PinInfo:
    """
    For now, do a simple heuristic:
      - pin_count from device info / package row
      - search for GND and VCC lines in 'Pin Functions' area
    This can be upgraded later with Camelot or an LLM.
    """
    gnd_pins = set()
    vcc_pins = set()

    full_text = "\n".join(page_texts)

    # Find region around 'Pin Functions'
    m = re.search(r'Pin Functions', full_text, flags=re.IGNORECASE)
    if m:
        region = full_text[m.start(): m.start() + 3000]  # window after "Pin Functions"
    else:
        region = full_text  # fallback

    for line in region.splitlines():
        # GND
        if "GND" in line:
            # e.g. "GND 7 10 — Ground"
            # try to find integers following GND
            nums = re.findall(r'GND\s+(\d+)', line)
            for n in nums:
                try:
                    gnd_pins.add(int(n))
                except ValueError:
                    pass

        # VCC
        if "VCC" in line:
            nums = re.findall(r'VCC\s+(\d+)', line)
            for n in nums:
                try:
                    vcc_pins.add(int(n))
                except ValueError:
                    pass

    # TI HC04 typical: 7 = GND, 14 = VCC. If we couldn't detect, guess these.
    if not gnd_pins and part_pin_count == 14:
        gnd_pins.add(7)
    if not vcc_pins and part_pin_count == 14:
        vcc_pins.add(14)

    return PinInfo(
        pin_count=part_pin_count,
        gnd_pins=sorted(gnd_pins),
        vcc_pins=sorted(vcc_pins),
    )


# ---------- Marking info ----------

def base_part_from_specific(part_number: str) -> str:
    """
    For SN74HC04D, SN74HC04PW etc., base part is the alphabetic prefix up to the first
    trailing package code letter (simple heuristic).
    For TI SN parts, it's usually everything up to the last digit, e.g. SN74HC04.
    """
    # strip trailing letters
    m = re.match(r'([A-Z]{2}\d+[A-Z0-9]*\d+)', part_number.upper())
    if m:
        return m.group(1)
    # fallback: remove last letter if alphabetic
    if part_number and part_number[-1].isalpha():
        return part_number[:-1]
    return part_number


def family_from_text(full_text: str) -> Optional[str]:
    """
    Try to detect a 'family' string like 'SNx4HC04' from the first page.
    """
    m = re.search(r'(SNx4HC0[0-9A-Z])', full_text)
    if m:
        return m.group(1)
    return None


def build_marking_info(part_number: str, base_part: str, family: Optional[str]) -> MarkingInfo:
    allowed = {part_number.upper(), base_part.upper()}
    if family:
        allowed.add(family.upper())
    return MarkingInfo(allowed_strings=sorted(allowed))


# ---------- Identity + mechanical aggregation ----------

def build_identity_and_mech(
    manufacturer: str,
    part_number: str,
    device_row: Dict[str, Any],
    full_text: str
) -> Tuple[ICIdentity, MechanicalSpecs]:
    base = base_part_from_specific(part_number)
    fam = family_from_text(full_text)

    package = device_row["package"]   # e.g. "SOIC"
    pin_count = device_row["pin_count"]
    length = device_row["length_mm"]
    width = device_row["width_mm"]

    # Height from mechanical outline
    height = extract_max_height_for_package(full_text, package)

    # Derived ratios
    length_width_ratio = None
    height_width_ratio = None
    if length and width:
        length_width_ratio = round(length / width, 3)
    if height and width:
        height_width_ratio = round(height / width, 3)

    identity = ICIdentity(
        manufacturer=manufacturer,
        base_part=base,
        specific_part=part_number,
        family=fam,
        package=package,
        pin_count=pin_count,
    )
    mech = MechanicalSpecs(
        body_length_nom_mm=length,
        body_width_nom_mm=width,
        body_height_max_mm=height,
        length_width_ratio=length_width_ratio,
        height_width_ratio=height_width_ratio,
    )
    return identity, mech


# ---------- Orchestrator ----------

def parse_datasheet(pdf_path: str, part_number: str, manufacturer: str = "Texas Instruments") -> DatasheetSpec:
    """
    High-level pipeline for datasheet parsing.
    1. Extract full text and per-page texts.
    2. Parse Device Information table.
    3. Choose package row for this part.
    4. Build identity + mechanical specs.
    5. Extract pin info.
    6. Build marking info.
    7. Return unified DatasheetSpec.
    """
    full_text = extract_full_text(pdf_path)
    page_texts = extract_page_texts(pdf_path)

    # 2. Device info
    device_rows = parse_device_info_table(full_text)
    if not device_rows:
        raise RuntimeError("Could not find any Device Information rows in datasheet")

    # 3. Pick correct package for this part
    chosen = choose_package_for_part(part_number, device_rows)

    # 4. Identity + mechanical
    identity, mech = build_identity_and_mech(manufacturer, part_number, chosen, full_text)

    # 5. Pins
    pin_info = extract_pin_info(page_texts, identity.pin_count)

    # 6. Markings
    marking_info = build_marking_info(identity.specific_part, identity.base_part, identity.family)

    # 7. Build final object
    spec = DatasheetSpec(
        ic_identity=identity,
        mechanical=mech,
        pins=pin_info,
        markings=marking_info,
        source_metadata={
            "datasheet_file": os.path.basename(pdf_path),
            "device_info_rows_found": len(device_rows),
        },
    )
    return spec


# ---------- CLI / testing ----------

if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="Parse TI IC datasheet into visual spec JSON.")
    parser.add_argument("pdf_path", help="Path to datasheet PDF (e.g., sn74hc04.pdf)")
    parser.add_argument("part_number", help="Part number to parse (e.g., SN74HC04D)")
    parser.add_argument("--manufacturer", default="Texas Instruments")
    parser.add_argument("--pretty", action="store_true")
    args = parser.parse_args()

    spec = parse_datasheet(args.pdf_path, args.part_number, manufacturer=args.manufacturer)
    data = {
        "ic_identity": asdict(spec.ic_identity),
        "mechanical": asdict(spec.mechanical),
        "pins": asdict(spec.pins),
        "markings": asdict(spec.markings),
        "source_metadata": spec.source_metadata,
    }

    if args.pretty:
        print(json.dumps(data, indent=2))
    else:
        print(json.dumps(data))
