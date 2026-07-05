"""Chat-style summary of a DetectionResult (ported from backend/api_server.py
generate_chat_response, unchanged in behavior)."""


def generate_chat_response(result) -> list:
    """Build the conversational summary message list for the chat UI."""
    part_num = result.part_number or "UNKNOWN"
    manufacturer = result.manufacturer or "UNKNOWN"
    package_type = result.package_type or "UNKNOWN"
    pin_count = result.pin_count or 0

    verdict = result.verdict or "UNKNOWN"
    verdict_emoji = {
        'AUTHENTIC': '✅',
        'LIKELY AUTHENTIC': '✅',
        'SUSPICIOUS': '⚠️',
        'SUSPICIOUS - REQUIRES INSPECTION': '⚠️',
        'COUNTERFEIT': '❌',
        'LIKELY COUNTERFEIT': '❌'
    }.get(verdict, '❓')

    auth_score = result.authenticity_score
    if auth_score is None or not isinstance(auth_score, (int, float)):
        auth_score = 0
    auth_score_str = f"{auth_score:.1f}"

    reasoning = getattr(result, 'reasoning', '') or ''

    summary_parts = []

    if part_num != "UNKNOWN":
        summary_parts.append(
            f"I've identified this IC as **{part_num}** from **{manufacturer}**. "
            f"The package type is **{package_type}** with **{pin_count} pins**.")

    if result.datasheet_path:
        summary_parts.append(
            "I've successfully retrieved and parsed the official OEM datasheet, "
            "extracting mechanical specifications and package dimensions.")

    if result.dimension_analysis:
        dim = result.dimension_analysis
        expected_ar = dim.get('expected_aspect_ratio')
        measured_ar = dim.get('measured_aspect_ratio')
        dim_score = dim.get('dimension_score', 0) or dim.get('confidence_score', 0) or 0

        if expected_ar and measured_ar:
            summary_parts.append(
                f"📐 **Dimension Analysis:** The expected aspect ratio from the datasheet is "
                f"**{expected_ar:.2f}**, while the measured aspect ratio is **{measured_ar:.2f}**. "
                f"This gives a dimension match score of **{dim_score:.1f}/100**.")
        elif measured_ar:
            summary_parts.append(
                f"📐 **Dimension Analysis:** I measured an aspect ratio of **{measured_ar:.2f}** "
                f"(score: **{dim_score:.1f}/100**).")

    if result.visual_comparison:
        visual = result.visual_comparison
        summary = visual.get('summary', '')
        if summary:
            if len(summary) > 200:
                truncated = summary[:200]
                last_sentence_end = max(truncated.rfind('.'), truncated.rfind('!'),
                                        truncated.rfind('?'))
                if last_sentence_end > 150:
                    summary = summary[:last_sentence_end + 1]
                else:
                    summary = truncated + '...'
            summary_parts.append(f"👁️ **Visual Analysis:** {summary}")

    if result.anomalies:
        anomaly_count = len(result.anomalies)
        anomaly_text = (f"⚠️ I detected **{anomaly_count} "
                        f"anomal{'y' if anomaly_count == 1 else 'ies'}** during the analysis:\n\n")
        for anomaly in result.anomalies[:3]:
            severity_emoji = {'high': '🔴', 'medium': '🟡', 'low': '🟢'}.get(
                anomaly.get('severity', 'medium'), '🟡')
            anomaly_text += (f"{severity_emoji} **{anomaly.get('type', 'Unknown').replace('_', ' ').title()}** "
                             f"({anomaly.get('severity', 'medium')} severity)\n")
            desc = anomaly.get('description', 'No description')
            if len(desc) > 150:
                truncated = desc[:150]
                last_sentence_end = max(truncated.rfind('.'), truncated.rfind('!'),
                                        truncated.rfind('?'))
                if last_sentence_end > 100:
                    desc = desc[:last_sentence_end + 1]
                else:
                    desc = truncated + '...'
            anomaly_text += f"   {desc}\n\n"
        summary_parts.append(anomaly_text)
    else:
        summary_parts.append(
            "✅ **No Anomalies:** I didn't detect any suspicious features in the visual analysis.")

    final_summary = '\n\n'.join(summary_parts)
    final_summary += f"\n\n{verdict_emoji} **Final Verdict: {verdict}**\n\n"
    final_summary += f"**Authenticity Score:** {auth_score_str}/100\n\n"
    if reasoning:
        final_summary += f"{reasoning}\n\n"
    final_summary += ("\n\n📄 **Download Report**\n\nA detailed PDF report with annotated "
                      "images and comprehensive analysis is available for download below.")

    return [{
        'type': 'summary',
        'content': final_summary,
    }]
