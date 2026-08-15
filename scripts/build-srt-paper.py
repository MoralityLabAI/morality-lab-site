"""Render the SRT research note from its Markdown source into a site-ready PDF."""

from pathlib import Path
from xml.sax.saxutils import escape

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import inch
from reportlab.platypus import Paragraph, Preformatted, SimpleDocTemplate, Spacer


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "papers" / "Spiroscopic_Recursive_Transformers.md"
OUTPUT = ROOT / "papers" / "Spiroscopic_Recursive_Transformers.pdf"


def styles():
    base = getSampleStyleSheet()
    return {
        "title": ParagraphStyle(
            "SRTTitle", parent=base["Title"], fontName="Helvetica-Bold", fontSize=23,
            leading=27, textColor=colors.HexColor("#0f2742"), spaceAfter=14, alignment=TA_CENTER,
        ),
        "subtitle": ParagraphStyle(
            "SRTSubtitle", parent=base["Normal"], fontName="Helvetica", fontSize=11,
            leading=15, textColor=colors.HexColor("#4a627a"), spaceAfter=22, alignment=TA_CENTER,
        ),
        "heading": ParagraphStyle(
            "SRTHeading", parent=base["Heading2"], fontName="Helvetica-Bold", fontSize=14,
            leading=18, textColor=colors.HexColor("#067d75"), spaceBefore=14, spaceAfter=7,
        ),
        "body": ParagraphStyle(
            "SRTBody", parent=base["BodyText"], fontName="Helvetica", fontSize=10,
            leading=14, textColor=colors.HexColor("#172b3a"), spaceAfter=8,
        ),
        "code": ParagraphStyle(
            "SRTCode", parent=base["Code"], fontName="Courier", fontSize=8.6,
            leading=11, textColor=colors.HexColor("#203c52"), leftIndent=15, rightIndent=10,
            backColor=colors.HexColor("#f0f5f8"), borderColor=colors.HexColor("#dbe5ef"),
            borderWidth=0.5, borderPadding=7, spaceBefore=3, spaceAfter=10,
        ),
    }


def paragraph(text: str) -> str:
    text = escape(text)
    return text.replace("**", "")


def build():
    text = SOURCE.read_text(encoding="utf-8")
    s = styles()
    story = []
    code_lines = []

    def flush_code():
        nonlocal code_lines
        if code_lines:
            story.append(Preformatted("\n".join(code_lines), s["code"]))
            code_lines = []

    for line in text.splitlines():
        if line.startswith("    "):
            code_lines.append(line[4:])
            continue
        flush_code()
        if not line:
            continue
        if line.startswith("# "):
            story.append(Paragraph(paragraph(line[2:]), s["title"]))
        elif line.startswith("## "):
            story.append(Paragraph(paragraph(line[3:]), s["subtitle"]))
        elif line.startswith("### "):
            story.append(Paragraph(paragraph(line[4:]), s["heading"]))
        elif line[:2].isdigit() and line[2:4] == ". ":
            story.append(Paragraph(paragraph(line), s["body"]))
        else:
            story.append(Paragraph(paragraph(line), s["body"]))
    flush_code()

    doc = SimpleDocTemplate(
        str(OUTPUT), pagesize=letter, rightMargin=0.72 * inch, leftMargin=0.72 * inch,
        topMargin=0.66 * inch, bottomMargin=0.68 * inch,
        title="Spiroscopic Recursive Transformers",
        author="Morality Lab",
    )

    def page_number(canvas, doc):
        canvas.saveState()
        canvas.setStrokeColor(colors.HexColor("#dbe5ef"))
        canvas.line(doc.leftMargin, 0.48 * inch, letter[0] - doc.rightMargin, 0.48 * inch)
        canvas.setFont("Helvetica", 8)
        canvas.setFillColor(colors.HexColor("#4a627a"))
        canvas.drawString(doc.leftMargin, 0.30 * inch, "Morality Lab Research Note | August 2026")
        canvas.drawRightString(letter[0] - doc.rightMargin, 0.30 * inch, f"Page {doc.page}")
        canvas.restoreState()

    doc.build(story, onFirstPage=page_number, onLaterPages=page_number)


if __name__ == "__main__":
    build()
