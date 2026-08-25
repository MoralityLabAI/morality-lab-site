"""Build the revised SRT research note as a publication-ready PDF."""

from pathlib import Path
from xml.sax.saxutils import escape

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_LEFT
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import inch
from reportlab.platypus import (
    KeepTogether,
    Paragraph,
    Preformatted,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "papers" / "Spiroscopic_Recursive_Transformers.md"
OUTPUT = ROOT / "papers" / "Spiroscopic_Recursive_Transformers.pdf"

NAVY = colors.HexColor("#10263f")
TEAL = colors.HexColor("#087f78")
INK = colors.HexColor("#1d2f3d")
SLATE = colors.HexColor("#52697c")
PALE = colors.HexColor("#edf5f5")
LINE = colors.HexColor("#d7e3e7")


def make_styles():
    base = getSampleStyleSheet()
    return {
        "title": ParagraphStyle(
            "Title", parent=base["Title"], fontName="Helvetica-Bold", fontSize=25,
            leading=29, textColor=NAVY, alignment=TA_CENTER, spaceAfter=12,
        ),
        "subtitle": ParagraphStyle(
            "Subtitle", parent=base["Normal"], fontName="Helvetica", fontSize=12,
            leading=17, textColor=TEAL, alignment=TA_CENTER, spaceAfter=10,
        ),
        "byline": ParagraphStyle(
            "Byline", parent=base["Normal"], fontName="Helvetica", fontSize=9,
            leading=12, textColor=SLATE, alignment=TA_CENTER, spaceAfter=24,
        ),
        "heading": ParagraphStyle(
            "Heading", parent=base["Heading2"], fontName="Helvetica-Bold", fontSize=14,
            leading=18, textColor=TEAL, spaceBefore=15, spaceAfter=7, keepWithNext=True,
        ),
        "body": ParagraphStyle(
            "Body", parent=base["BodyText"], fontName="Helvetica", fontSize=9.7,
            leading=13.6, textColor=INK, alignment=TA_LEFT, spaceAfter=8,
        ),
        "abstract": ParagraphStyle(
            "Abstract", parent=base["BodyText"], fontName="Helvetica", fontSize=9.5,
            leading=13.4, textColor=INK, leftIndent=13, rightIndent=13,
            borderColor=LINE, borderWidth=0.6, borderPadding=10,
            backColor=colors.HexColor("#f7fafb"), spaceAfter=14,
        ),
        "bullet": ParagraphStyle(
            "Bullet", parent=base["BodyText"], fontName="Helvetica", fontSize=9.5,
            leading=13.2, textColor=INK, leftIndent=15, firstLineIndent=-8, spaceAfter=4,
        ),
        "code": ParagraphStyle(
            "Code", parent=base["Code"], fontName="Courier", fontSize=8.3,
            leading=10.8, textColor=colors.HexColor("#29485b"), leftIndent=12,
            rightIndent=8, borderColor=LINE, borderWidth=0.5, borderPadding=7,
            backColor=colors.HexColor("#f1f6f8"), spaceBefore=2, spaceAfter=9,
        ),
        "table_header": ParagraphStyle(
            "TableHeader", parent=base["BodyText"], fontName="Helvetica-Bold",
            fontSize=8.5, leading=11, textColor=colors.white,
        ),
        "table": ParagraphStyle(
            "Table", parent=base["BodyText"], fontName="Helvetica", fontSize=8.5,
            leading=11, textColor=INK,
        ),
    }


def clean(text: str) -> str:
    return escape(text).replace("**", "")


def evidence_table(styles):
    data = [
        [Paragraph("Measure", styles["table_header"]), Paragraph("Observed result", styles["table_header"])],
        [Paragraph("Synthetic exact solve", styles["table"]), Paragraph("SRT 47/64 (73.44%); residual beam 35/64 (54.69%)", styles["table"])],
        [Paragraph("Matched-control margin", styles["table"]), Paragraph("+18.75 points; root-block 95% interval [+4.69, +34.38]", styles["table"])],
        [Paragraph("Held-out families", styles["table"]), Paragraph("Positive margins in 4/4 composition families", styles["table"])],
        [Paragraph("Order counterfactual", styles["table"]), Paragraph("Same candidate set, shuffled order: 47/64 (tie)", styles["table"])],
        [Paragraph("Public ARC", styles["table"]), Paragraph("0/24 exact solves; descriptive only", styles["table"])],
        [Paragraph("Current reproducibility", styles["table"]), Paragraph("Summary recovered; rows and checkpoints not trustworthy", styles["table"])],
    ]
    table = Table(data, colWidths=[1.55 * inch, 4.85 * inch], repeatRows=1, hAlign="CENTER")
    table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), NAVY),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, PALE]),
        ("GRID", (0, 0), (-1, -1), 0.45, LINE),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 7),
        ("RIGHTPADDING", (0, 0), (-1, -1), 7),
        ("TOPPADDING", (0, 0), (-1, -1), 6),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
    ]))
    return table


def build():
    lines = SOURCE.read_text(encoding="utf-8").splitlines()
    styles = make_styles()
    story = []
    code_lines = []
    abstract_mode = False
    title_seen = False
    subtitle_seen = False
    evidence_added = False

    def flush_code():
        nonlocal code_lines
        if code_lines:
            story.append(Preformatted("\n".join(code_lines), styles["code"]))
            code_lines = []

    for line in lines:
        if line.startswith("    "):
            code_lines.append(line[4:])
            continue
        flush_code()
        if not line:
            continue
        if line.startswith("# "):
            story.append(Spacer(1, 0.35 * inch))
            story.append(Paragraph(clean(line[2:]), styles["title"]))
            title_seen = True
        elif line.startswith("## ") and title_seen and not subtitle_seen:
            story.append(Paragraph(clean(line[3:]), styles["subtitle"]))
            subtitle_seen = True
        elif line.startswith("### "):
            heading = line[4:]
            if heading == "Abstract":
                story.append(Paragraph("Abstract", styles["heading"]))
                abstract_mode = True
            else:
                if abstract_mode and not evidence_added:
                    story.append(KeepTogether([Paragraph("Evidence at a glance", styles["heading"]), evidence_table(styles)]))
                    evidence_added = True
                    abstract_mode = False
                story.append(Paragraph(clean(heading), styles["heading"]))
        elif line.startswith("Morality Lab Research Note"):
            story.append(Paragraph(clean(line), styles["byline"]))
        elif line.startswith("- "):
            story.append(Paragraph(clean(line[2:]), styles["bullet"], bulletText="-"))
        elif len(line) > 3 and line[0].isdigit() and ". " in line[:4]:
            marker, content = line.split(". ", 1)
            story.append(Paragraph(clean(f"{marker}.  {content}"), styles["bullet"]))
            story.append(Spacer(1, 2))
        else:
            story.append(Paragraph(clean(line), styles["abstract"] if abstract_mode else styles["body"]))
    flush_code()

    doc = SimpleDocTemplate(
        str(OUTPUT), pagesize=letter, leftMargin=0.72 * inch, rightMargin=0.72 * inch,
        topMargin=0.64 * inch, bottomMargin=0.68 * inch,
        title="Spiroscopic Recursive Transformers", author="Morality Lab",
        subject="Learned function-space neighborhoods for bounded program discovery",
    )

    def page(canvas, document):
        canvas.saveState()
        width, _ = letter
        canvas.setStrokeColor(LINE)
        canvas.line(document.leftMargin, 0.48 * inch, width - document.rightMargin, 0.48 * inch)
        canvas.setFont("Helvetica", 7.8)
        canvas.setFillColor(SLATE)
        canvas.drawString(document.leftMargin, 0.29 * inch, "Morality Lab Research Note | Revised August 2026")
        canvas.drawRightString(width - document.rightMargin, 0.29 * inch, f"Page {document.page}")
        canvas.restoreState()

    doc.build(story, onFirstPage=page, onLaterPages=page)


if __name__ == "__main__":
    build()
