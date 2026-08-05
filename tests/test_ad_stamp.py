"""
AdStamp contract-level regression tests.

Tests call AdStamp.submit() directly and prove:
  - Fetched media is converted to gl.nondet.Image (explicit supported type)
  - Fetch boundary validates HTTP status, Content-Type header, body size
  - A contract-level approved submission updates state and emits transfers

Run: pytest tests/test_ad_stamp.py -v
"""

import json
import os
import sys
import types
import pytest

# ---------------------------------------------------------------------------
# GenLayer stubs
# ---------------------------------------------------------------------------

class _Addr:
    def __init__(self, v="0x0000000000000000000000000000000000000000"):
        self.as_hex = v if isinstance(v, str) else "0x" + v.hex()
    def __eq__(self, o): return isinstance(o, _Addr) and self.as_hex.lower() == o.as_hex.lower()
    def __hash__(self): return hash(self.as_hex.lower())

class _U256(int):
    pass

class _UserError(Exception):
    pass

class _Return:
    def __init__(self, cd): self.calldata = cd

class _VM:
    UserError = _UserError
    Result = object
    Return = _Return
    @staticmethod
    def run_nondet_unsafe(lf, vf):
        return lf()

_transfers = []
_last_exec_images = []
_last_render_url = None

class _PayeeMeta(type):
    def __call__(cls, addr):
        inst = super().__call__(); inst._addr = addr; return inst

class _PayeeStub(metaclass=_PayeeMeta):
    class View: pass
    class Write: pass
    def emit_transfer(self, value=0):
        _transfers.append({"to": self._addr, "value": value})

class _ImageStub:
    def __init__(self, raw=None, pil=None):
        self.raw = raw
        self.pil = pil

class _WebStub:
    get_fn = None
    render_fn = None

    @classmethod
    def get(cls, url):
        if cls.get_fn: return cls.get_fn(url)
        raise RuntimeError("web.get not mocked")

    @classmethod
    def render(cls, url, mode="html"):
        global _last_render_url
        _last_render_url = url
        if cls.render_fn: return cls.render_fn(url, mode)
        if mode == "screenshot":
            return _ImageStub(raw=b"rendered-image", pil="rendered")
        return ""

class _NondetStub:
    web = _WebStub()
    Image = _ImageStub
    exec_prompt_fn = None
    @classmethod
    def exec_prompt(cls, prompt, *, images=None, response_format=None):
        _last_exec_images.clear()
        if images: _last_exec_images.extend(images)
        if cls.exec_prompt_fn:
            return cls.exec_prompt_fn(prompt, images=images, response_format=response_format)
        raise RuntimeError("exec_prompt not mocked")

class _MsgStub:
    sender_address = _Addr("0xCREATOR0000000000000000000000000000000001")
    value = _U256(0)

class _GL:
    vm = _VM
    nondet = _NondetStub
    message = _MsgStub
    class evm:
        @staticmethod
        def contract_interface(cls): return _PayeeStub
    class public:
        class write:
            @staticmethod
            def payable(fn): return fn
            def __call__(self, fn): return fn
        class view:
            def __call__(self, fn): return fn
    class Contract: pass

_w = _GL.public.write(); _GL.public.write = _w; _GL.public.write.payable = staticmethod(lambda fn: fn)
_v = _GL.public.view(); _GL.public.view = _v

_mod = types.ModuleType("genlayer")
_mod.gl = _GL
_mod.Address = _Addr
_mod.u256 = _U256
_mod.TreeMap = dict
_mod.allow_storage = lambda c: c
_mod.__all__ = ["gl", "Address", "u256", "TreeMap", "allow_storage"]
sys.modules["genlayer"] = _mod

# ---------------------------------------------------------------------------
# Import contract
# ---------------------------------------------------------------------------

CONTRACT_PATH = os.path.join(os.path.dirname(__file__), "..", "contracts", "ad_stamp.py")
_ns = {"__name__": "ad_stamp", "__file__": CONTRACT_PATH}
with open(CONTRACT_PATH) as f:
    src = f.read()
lines = src.split("\n")
if lines[0].startswith("# {") and "Depends" in lines[0]:
    lines[0] = ""
exec("\n".join(lines), _ns)

AdStamp = _ns["AdStamp"]
_fetch_as_supported_image = _ns["_fetch_as_supported_image"]
MAX_IMAGE_BYTES = _ns["MAX_IMAGE_BYTES"]

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

BRAND = _Addr("0xBRAND000000000000000000000000000000000001")
CREATOR = _Addr("0xCREATOR0000000000000000000000000000000001")
VALID_JPEG = b"\xff\xd8\xff" + b"\x00" * 100
VALID_PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 100

def _resp(body=VALID_JPEG, status=200, ct="image/jpeg"):
    class R: pass
    r = R(); r.body = body; r.status = status
    r.headers = {"content-type": ct} if ct else {}
    return r

def _fresh_contract():
    _GL.message.sender_address = BRAND
    _GL.message.value = _U256(5 * 10**18)
    c = AdStamp.__new__(AdStamp)
    c.campaigns = {}
    c.submissions = {}
    c.claimed = {}
    c.__init__()
    cid = c.create_campaign("Test", "Show product on a beach", _U256(10**18))
    return c, int(cid)

# ---------------------------------------------------------------------------
# Tests: fetch boundary
# ---------------------------------------------------------------------------

class TestFetchSupportedImage:
    def test_valid_jpeg_renders_image(self):
        _WebStub.get_fn = lambda url: _resp(VALID_JPEG, 200, "image/jpeg")
        _WebStub.render_fn = lambda url, mode: _ImageStub(raw=b"rendered-jpeg", pil="img")
        img = _fetch_as_supported_image("https://example.com/photo.jpg")
        assert isinstance(img, _ImageStub)
        assert img.raw == b"rendered-jpeg"
        assert _last_render_url == "https://example.com/photo.jpg"

    def test_valid_png_renders_image(self):
        _WebStub.get_fn = lambda url: _resp(VALID_PNG, 200, "image/png")
        _WebStub.render_fn = lambda url, mode: _ImageStub(raw=b"rendered-png", pil="img")
        img = _fetch_as_supported_image("https://example.com/photo.png")
        assert isinstance(img, _ImageStub)

    def test_403_raises(self):
        _WebStub.get_fn = lambda url: _resp(status=403)
        with pytest.raises(_UserError, match="403"):
            _fetch_as_supported_image("https://blocked.example.com/x")

    def test_500_raises(self):
        _WebStub.get_fn = lambda url: _resp(status=500)
        with pytest.raises(_UserError, match="unavailable"):
            _fetch_as_supported_image("https://down.example.com/x")

    def test_empty_body_raises(self):
        _WebStub.get_fn = lambda url: _resp(body=b"")
        with pytest.raises(_UserError, match="empty"):
            _fetch_as_supported_image("https://x.com/e")

    def test_unsupported_mime_raises(self):
        _WebStub.get_fn = lambda url: _resp(body=b"<html></html>", ct="text/html")
        with pytest.raises(_UserError, match="unsupported content type"):
            _fetch_as_supported_image("https://x.com/html")

    def test_too_large_raises(self):
        body = b"\xff\xd8\xff" + b"\x00" * MAX_IMAGE_BYTES
        _WebStub.get_fn = lambda url: _resp(body=body, ct="image/jpeg")
        with pytest.raises(_UserError, match="too large"):
            _fetch_as_supported_image("https://x.com/huge")

# ---------------------------------------------------------------------------
# Tests: contract-level AdStamp.submit()
# ---------------------------------------------------------------------------

class TestContractSubmitApproved:
    def test_approved_payout(self):
        _transfers.clear(); _last_exec_images.clear()
        _WebStub.get_fn = lambda url: _resp(VALID_JPEG, 200, "image/jpeg")
        _WebStub.render_fn = lambda url, mode: _ImageStub(raw=b"rendered-approved", pil="img")
        _NondetStub.exec_prompt_fn = lambda prompt, **kw: json.dumps({
            "compliant": True, "score": 88, "reason": "Image shows product on beach correctly."
        })

        contract, cid = _fresh_contract()
        _GL.message.sender_address = CREATOR
        _GL.message.value = _U256(0)

        result = contract.submit(_U256(cid), "https://i.imgur.com/test.jpeg")
        assert result == "approved"

        # Critical assertion: exec_prompt received an explicit SDK-supported image object.
        assert len(_last_exec_images) == 1
        assert isinstance(_last_exec_images[0], _ImageStub)

        # State changes
        assert contract.get_submission_count() == 1
        sub = contract.get_submission(_U256(0))
        assert sub["status"] == "approved"
        assert sub["score"] == 88
        assert sub["paid_amount"] == str(int(0.95 * 10**18))

        camp_after = contract.get_campaign(_U256(cid))
        assert camp_after["payouts_made"] == 1
        assert int(camp_after["escrow_balance"]) == 4 * 10**18

        # Transfers
        assert len(_transfers) == 2
        assert _transfers[0]["value"] == int(0.95 * 10**18)
        assert _transfers[1]["value"] == int(0.05 * 10**18)

        # Claimed flag
        assert contract.has_claimed(_U256(cid), CREATOR) is True

class TestContractSubmitRejected:
    def test_rejected_no_payout(self):
        _transfers.clear()
        _WebStub.get_fn = lambda url: _resp(VALID_JPEG, 200, "image/jpeg")
        _WebStub.render_fn = lambda url, mode: _ImageStub(raw=b"rendered-rejected", pil="img")
        _NondetStub.exec_prompt_fn = lambda prompt, **kw: json.dumps({
            "compliant": False, "score": 12, "reason": "No product visible."
        })
        contract, cid = _fresh_contract()
        _GL.message.sender_address = CREATOR; _GL.message.value = _U256(0)
        assert contract.submit(_U256(cid), "https://x.com/bad.jpg") == "rejected"
        assert contract.get_submission(_U256(0))["paid_amount"] == "0"
        assert int(contract.get_campaign(_U256(cid))["escrow_balance"]) == 5 * 10**18
        assert len(_transfers) == 0
        assert contract.has_claimed(_U256(cid), CREATOR) is False

class TestContractSubmitFetchError:
    def test_403_rollback(self):
        _WebStub.get_fn = lambda url: _resp(status=403)
        contract, cid = _fresh_contract()
        _GL.message.sender_address = CREATOR; _GL.message.value = _U256(0)
        with pytest.raises(_UserError, match="403"):
            contract.submit(_U256(cid), "https://blocked.example.com/img.jpg")
        assert contract.get_submission_count() == 0

class TestContractSubmitDuplicate:
    def test_double_submit_blocked(self):
        _WebStub.get_fn = lambda url: _resp(VALID_JPEG, 200, "image/jpeg")
        _WebStub.render_fn = lambda url, mode: _ImageStub(raw=b"rendered-ok", pil="img")
        _NondetStub.exec_prompt_fn = lambda prompt, **kw: json.dumps({
            "compliant": True, "score": 90, "reason": "ok"
        })
        contract, cid = _fresh_contract()
        _GL.message.sender_address = CREATOR; _GL.message.value = _U256(0)
        assert contract.submit(_U256(cid), "https://x.com/a.jpg") == "approved"
        with pytest.raises(_UserError, match="already rewarded"):
            contract.submit(_U256(cid), "https://x.com/b.jpg")

class TestPayoutMath:
    def test_fee(self):
        b = 10**18; fee = (b * 500) // 10000; net = b - fee
        assert fee == 5 * 10**16
        assert net == 95 * 10**16
