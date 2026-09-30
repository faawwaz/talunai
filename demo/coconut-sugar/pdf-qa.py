"""Optional local visual QA: python3 demo/coconut-sugar/pdf-qa.py [instance].

Requires PyMuPDF (python3 -m pip install PyMuPDF). Never creates application screenshots.
"""
import json
import pathlib
import sys

import fitz

instance = sys.argv[1] if len(sys.argv) > 1 else "hero"
if not instance or any(c not in "abcdefghijklmnopqrstuvwxyz0123456789-" for c in instance):
    raise SystemExit("INVALID_INSTANCE")
root = pathlib.Path(__file__).resolve().parents[2]
output = root / "demo-artifacts" / "coconut-sugar" / instance
qa = output / "qa"
qa.mkdir(parents=True, exist_ok=True)
findings = []
for name in ["invoice", "delivery-note", "buyer-acknowledgement"]:
    document = fitz.open(output / "documents" / f"{name}.pdf")
    assert len(document) == 1
    page = document[0]
    spans = []
    for block in page.get_text("dict")["blocks"]:
        for line in block.get("lines", []):
            for span in line["spans"]:
                bounds = fitz.Rect(span["bbox"])
                if bounds.x0 < 0 or bounds.y0 < 0 or bounds.x1 > page.rect.width or bounds.y1 > page.rect.height:
                    findings.append({"document": name, "issue": "TEXT_OUTSIDE_PAGE", "text": span["text"]})
                spans.append(span)
    for index, a in enumerate(spans):
        for b in spans[index + 1:]:
            overlap = fitz.Rect(a["bbox"]) & fitz.Rect(b["bbox"])
            if overlap.width > 1 and overlap.height > 1:
                findings.append({"document": name, "issue": "TEXT_OVERLAP", "text": [a["text"], b["text"]]})
    text = page.get_text()
    assert "SIMULASI DEMO - BUKAN TRANSAKSI NYATA" in text
    assert "Bukan dokumen resmi Unilever" in text
    assert "Settlement demo: IDRT" in text
    assert "BNB Chain Testnet" in text
    assert "MockIDR" not in text
    page.get_pixmap(matrix=fitz.Matrix(1.5, 1.5), alpha=False).save(qa / f"{name}-preview.png")
    document.close()
report = {"status": "PASSED" if not findings else "FAILED", "findings": findings, "scope": "Generated PDF layout only; not browser capture or blockchain proof"}
(qa / "pdf-visual-qa.json").write_text(json.dumps(report, indent=2) + "\n")
print(json.dumps(report))
if findings:
    raise SystemExit(1)
