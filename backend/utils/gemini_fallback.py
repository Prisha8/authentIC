"""Gemini model wrapper that falls back to cheaper models when the free-tier
daily quota is exhausted (free tier: ~20 requests/day *per model*, so each
extra model in the chain adds its own daily budget)."""

import os

import google.generativeai as genai

DEFAULT_CHAIN = ["gemini-2.5-flash", "gemini-2.5-flash-lite", "gemini-2.0-flash"]


def _chain():
    env = os.getenv("GEMINI_MODEL_CHAIN")
    if env:
        return [m.strip() for m in env.split(",") if m.strip()]
    return list(DEFAULT_CHAIN)


def _is_quota_error(exc) -> bool:
    text = str(exc).lower()
    return "429" in text or "quota" in text or "resource_exhausted" in text


class FallbackGenerativeModel:
    """Drop-in for genai.GenerativeModel: on a quota error, retries the next
    model in the chain and sticks with it for subsequent calls."""

    def __init__(self, preferred: str = None, **kwargs):
        chain = _chain()
        if preferred:
            if preferred in chain:
                chain = chain[chain.index(preferred):]
            else:
                chain = [preferred] + chain
        self._names = chain
        self._kwargs = kwargs
        self._models = {}
        self._active = 0

    def _model(self, name):
        if name not in self._models:
            self._models[name] = genai.GenerativeModel(name, **self._kwargs)
        return self._models[name]

    @property
    def active_model_name(self) -> str:
        return self._names[self._active]

    def generate_content(self, *args, **kwargs):
        # A dropped connection can otherwise block a detection thread forever
        kwargs.setdefault("request_options", {"timeout": 180})
        last_exc = None
        for i in range(self._active, len(self._names)):
            try:
                resp = self._model(self._names[i]).generate_content(*args, **kwargs)
                self._active = i
                return resp
            except Exception as exc:
                if _is_quota_error(exc) and i + 1 < len(self._names):
                    print(f"  ⚠ {self._names[i]} quota exhausted, "
                          f"falling back to {self._names[i + 1]}")
                    self._active = i + 1
                    last_exc = exc
                    continue
                raise
        raise last_exc if last_exc else RuntimeError("no Gemini model available")

    def start_chat(self, **kwargs):
        # Chat sessions bind to one concrete model; use the active one. Quota
        # errors surface on send_message, which the caller already handles.
        return self._model(self.active_model_name).start_chat(**kwargs)
