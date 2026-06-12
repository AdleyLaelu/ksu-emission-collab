"""
Report Generator Blueprint
- POST /api/report/generate  → AI chat / report generation
- GET  /api/report/download/<id> → serve generated PDF
"""

import os
import re
import uuid
import json
import base64
import tempfile
from datetime import datetime

from flask import Blueprint, request, jsonify, send_file
from openai import OpenAI
from fpdf import FPDF

report_bp = Blueprint("report", __name__)

# Store generated reports in a temp directory
REPORT_DIR = os.path.join(tempfile.gettempdir(), "emission_reports")
os.makedirs(REPORT_DIR, exist_ok=True)

SYSTEM_PROMPT = """\
You are an expert analyst specializing in vehicle emissions and energy grid analysis.
You help users generate professional reports based on their emission analysis results.

When the user's request is clear enough to generate a report, produce a well-structured
report using proper markdown headers for ALL section titles:
- Use ## for major sections (e.g., ## Executive Summary, ## Key Findings, ## Data Analysis, ## Conclusions)
- Use ### for subsections
- Use bullet points (- ) for lists
- Use numbered lists (1., 2., etc.) where appropriate
- Use **bold** for emphasis on key terms or values

The report should include sections such as Executive Summary, Key Findings, Data Analysis,
and Conclusions. Use the provided context data to ground your analysis.

Note: Charts from the user's current analysis view are available and will be automatically
included in the generated PDF report alongside your written analysis.

When the user's request is vague or needs clarification, ask a specific follow-up question.

Always be concise, data-driven, and professional in tone.
"""


def _get_client():
    api_key = os.environ.get("OPENAI_API_KEY")
    if not api_key:
        return None
    return OpenAI(api_key=api_key)


def _build_context_summary(context: dict) -> str:
    """Build a readable summary string from the analysis context."""
    if not context:
        return "No analysis context provided."

    parts = []
    for key in ["mode", "city", "state", "vehicleType", "baseYear",
                 "fuelType", "emissionType", "chartMode", "speedKmh",
                 "vehicleWeightKg"]:
        val = context.get(key)
        if val is not None and val != "":
            parts.append(f"- {key}: {val}")

    snapshot = context.get("dataSnapshot")
    if snapshot and isinstance(snapshot, dict):
        parts.append("\nData Summary:")
        for metric, stats in snapshot.items():
            if isinstance(stats, dict):
                parts.append(f"  {metric}: {json.dumps(stats)}")
            else:
                parts.append(f"  {metric}: {stats}")

    return "\n".join(parts) if parts else "No analysis context provided."


def _sanitize_text(text: str) -> str:
    """Replace non-ASCII characters that Helvetica can't render."""
    replacements = {
        "\u2018": "'", "\u2019": "'",   # smart single quotes
        "\u201C": '"', "\u201D": '"',   # smart double quotes
        "\u2013": "-", "\u2014": "--",  # en-dash, em-dash
        "\u2026": "...",                # ellipsis
        "\u2022": "-",                  # bullet
        "\u00b0": " deg",              # degree symbol
        "\u2032": "'", "\u2033": '"',   # prime, double prime
    }
    for orig, repl in replacements.items():
        text = text.replace(orig, repl)
    # Fallback: replace any remaining non-latin1 chars
    text = text.encode("latin-1", errors="replace").decode("latin-1")
    return text


def _strip_markdown(text: str) -> str:
    """Remove common markdown formatting characters."""
    # Remove bold/italic markers
    text = re.sub(r'\*{1,3}(.*?)\*{1,3}', r'\1', text)
    text = re.sub(r'_{1,3}(.*?)_{1,3}', r'\1', text)
    # Remove inline code backticks
    text = re.sub(r'`(.*?)`', r'\1', text)
    return _sanitize_text(text)


def _is_heading(line: str):
    """Detect heading lines — both markdown (##) and numbered bold patterns.

    Returns (level, text) or None.
    level 1 = '#', level 2 = '##', level 3 = '###'.
    Numbered bold patterns like '1. **Executive Summary**' are treated as level 2.
    """
    stripped = line.strip()

    # Standard markdown headers
    if stripped.startswith("### "):
        return (3, stripped[4:])
    if stripped.startswith("## "):
        return (2, stripped[3:])
    if stripped.startswith("# "):
        return (1, stripped[2:])

    # Numbered bold headers: e.g. "1. **Executive Summary**" or "1. **Executive Summary:**"
    m = re.match(r'^\d+\.\s+\*\*(.+?)\*\*:?\s*$', stripped)
    if m:
        return (2, m.group(1))

    return None


def _write_paragraph(pdf, text, w, line_h=6):
    """Write a paragraph, resetting x to left margin first."""
    pdf.set_x(pdf.l_margin)
    pdf.multi_cell(w, line_h, text)


def _embed_chart_images(pdf, chart_images, w):
    """Embed base64-encoded chart images into the PDF."""
    if not chart_images:
        return

    pdf.add_page()
    pdf.set_font("Helvetica", "B", 14)
    _write_paragraph(pdf, "Charts", w, 8)
    pdf.ln(4)

    for img_info in chart_images:
        label = img_info.get("label", "Chart")
        data = img_info.get("data", "")
        if not data:
            continue

        # Strip data URI prefix if present
        if "," in data:
            data = data.split(",", 1)[1]

        try:
            img_bytes = base64.b64decode(data)
        except Exception:
            continue

        # Write to a temp file for fpdf
        tmp_path = os.path.join(REPORT_DIR, f"_tmp_{uuid.uuid4().hex}.png")
        try:
            with open(tmp_path, "wb") as f:
                f.write(img_bytes)

            # Check if we need a new page (leave room for label + image)
            if pdf.get_y() + 100 > pdf.h - 30:
                pdf.add_page()

            pdf.set_font("Helvetica", "B", 11)
            _write_paragraph(pdf, _sanitize_text(label), w, 7)
            pdf.ln(2)

            # Fit image to page width, maintaining aspect ratio
            pdf.image(tmp_path, x=pdf.l_margin, w=min(w, 170))
            pdf.ln(8)
        except Exception:
            # If image embedding fails, just note it
            pdf.set_font("Helvetica", "I", 10)
            _write_paragraph(pdf, f"[Chart: {_sanitize_text(label)} - could not be embedded]", w, 6)
            pdf.ln(4)
        finally:
            if os.path.exists(tmp_path):
                os.remove(tmp_path)

    pdf.set_font("Helvetica", "", 11)


def _create_pdf(report_text: str, context: dict) -> str:
    """Generate a PDF from the report text. Returns the report id."""
    LEFT = 20
    RIGHT = 20
    pdf = FPDF()
    pdf.set_auto_page_break(auto=True, margin=20)
    pdf.set_left_margin(LEFT)
    pdf.set_right_margin(RIGHT)
    pdf.add_page()

    W = pdf.w - LEFT - RIGHT  # usable width
    INDENT = 8                # bullet indent

    # Title
    pdf.set_font("Helvetica", "B", 16)
    pdf.cell(0, 10, "Emission Analysis Report", ln=True, align="C")
    pdf.ln(4)

    # Metadata line
    pdf.set_font("Helvetica", "", 9)
    meta_parts = []
    if context.get("city"):
        meta_parts.append(context["city"])
    if context.get("state"):
        meta_parts.append(context["state"])
    if context.get("mode"):
        meta_parts.append(context["mode"])
    meta_parts.append(datetime.now().strftime("%Y-%m-%d %H:%M"))
    pdf.cell(0, 6, _sanitize_text(" | ".join(meta_parts)), ln=True, align="C")
    pdf.ln(8)

    # Body
    pdf.set_font("Helvetica", "", 11)
    for line in report_text.split("\n"):
        stripped = line.strip()

        heading = _is_heading(stripped)
        if heading:
            level, text = heading
            if level == 1:
                pdf.ln(4)
                pdf.set_font("Helvetica", "B", 15)
                _write_paragraph(pdf, _strip_markdown(text), W, 10)
            elif level == 2:
                pdf.ln(4)
                pdf.set_font("Helvetica", "B", 13)
                _write_paragraph(pdf, _strip_markdown(text), W, 8)
            else:  # level 3
                pdf.ln(2)
                pdf.set_font("Helvetica", "BI", 12)
                _write_paragraph(pdf, _strip_markdown(text), W, 7)
            pdf.set_font("Helvetica", "", 11)

        elif stripped.startswith("- ") or stripped.startswith("* "):
            bullet_text = "  -  " + _strip_markdown(stripped[2:])
            _write_paragraph(pdf, bullet_text, W, 6)

        elif re.match(r'^\d+\.\s', stripped):
            # Numbered list items (that aren't headings — headings caught above)
            _write_paragraph(pdf, "  " + _strip_markdown(stripped), W, 6)

        elif stripped == "" or stripped == "---":
            pdf.ln(3)

        else:
            _write_paragraph(pdf, _strip_markdown(stripped), W, 6)

    # Embed chart images at the end
    chart_images = context.get("chartImages", [])
    _embed_chart_images(pdf, chart_images, W)

    report_id = str(uuid.uuid4())
    filepath = os.path.join(REPORT_DIR, f"{report_id}.pdf")
    pdf.output(filepath)
    return report_id


def _is_report_request(prompt: str, conversation: list) -> bool:
    """Heuristic: if user explicitly asks to generate/create a report, treat it as such."""
    lower = prompt.lower()
    keywords = ["generate", "create", "write", "produce", "make", "build", "draft"]
    report_words = ["report", "summary", "analysis", "document"]
    return any(k in lower for k in keywords) and any(r in lower for r in report_words)


@report_bp.route("/api/report/generate", methods=["POST"])
def generate_report():
    client = _get_client()
    if not client:
        return jsonify({
            "type": "message",
            "content": "OpenAI API key is not configured. Please set the OPENAI_API_KEY environment variable on the backend server."
        }), 200

    data = request.get_json(silent=True) or {}
    prompt = data.get("prompt", "").strip()
    context = data.get("context", {})
    conversation = data.get("conversation", [])

    if not prompt:
        return jsonify({"type": "message", "content": "Please enter a message."}), 200

    # Build messages for OpenAI (exclude chartImages from context summary — they're binary)
    context_for_summary = {k: v for k, v in context.items() if k != "chartImages"}
    context_summary = _build_context_summary(context_for_summary)
    messages = [
        {"role": "system", "content": SYSTEM_PROMPT},
        {"role": "system", "content": f"Current analysis context:\n{context_summary}"},
    ]

    # Add conversation history (limit to last 20 messages)
    for msg in conversation[-20:]:
        role = msg.get("role", "user")
        content = msg.get("content", "")
        if role in ("user", "assistant") and content:
            messages.append({"role": role, "content": content})

    # Add current prompt
    messages.append({"role": "user", "content": prompt})

    try:
        response = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=messages,
            max_tokens=2000,
            temperature=0.7,
        )
        ai_content = response.choices[0].message.content

        # If this looks like a report generation request, create a PDF
        if _is_report_request(prompt, conversation):
            report_id = _create_pdf(ai_content, context)
            return jsonify({
                "type": "report",
                "content": ai_content,
                "downloadUrl": f"/api/report/download/{report_id}",
            }), 200

        return jsonify({"type": "message", "content": ai_content}), 200

    except Exception as e:
        return jsonify({
            "type": "message",
            "content": f"An error occurred while generating the report: {str(e)}"
        }), 200


@report_bp.route("/api/report/download/<report_id>", methods=["GET"])
def download_report(report_id):
    # Sanitize the id to prevent path traversal
    safe_id = report_id.replace("/", "").replace("\\", "").replace("..", "")
    filepath = os.path.join(REPORT_DIR, f"{safe_id}.pdf")

    if not os.path.isfile(filepath):
        return jsonify({"error": "Report not found"}), 404

    return send_file(
        filepath,
        mimetype="application/pdf",
        as_attachment=True,
        download_name=f"emission_report_{safe_id[:8]}.pdf",
    )
