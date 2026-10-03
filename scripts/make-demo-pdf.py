# 체험용 교안 PDF 만들기: demo/os-lecture.json → public/demo/운영체제_체험교안.pdf
# 한글이 브라우저 추출(pdf.js)에서 깨지지 않도록 Pretendard(SIL OFL)를 PDF에 내장한다.
# 실행: python scripts/make-demo-pdf.py
import json
import os
import pymupdf as fitz  # PyMuPDF

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FONT_DIR = os.path.join(os.environ["LOCALAPPDATA"], "Microsoft", "Windows", "Fonts")
REGULAR = os.path.join(FONT_DIR, "Pretendard-Regular.ttf")
BOLD = os.path.join(FONT_DIR, "Pretendard-Bold.ttf")

lecture = json.load(open(os.path.join(ROOT, "demo", "os-lecture.json"), encoding="utf-8"))
out_dir = os.path.join(ROOT, "public", "demo")
os.makedirs(out_dir, exist_ok=True)
out = os.path.join(out_dir, "운영체제_체험교안.pdf")

doc = fitz.open()
for p in lecture["pages"]:
    page = doc.new_page(width=595, height=842)  # A4
    page.insert_font(fontname="pb", fontfile=BOLD)
    page.insert_font(fontname="pr", fontfile=REGULAR)
    page.insert_text((56, 70), f"{p['page']}. {p['title']}", fontname="pb", fontsize=20)
    page.insert_textbox(fitz.Rect(56, 100, 539, 780), p["text"], fontname="pr", fontsize=12, lineheight=1.6)
    page.insert_text((56, 815), lecture["title"], fontname="pr", fontsize=8, color=(0.45, 0.45, 0.45))
doc.subset_fonts()  # 쓴 글자만 내장해 파일을 줄인다
doc.set_metadata({"title": lecture["title"], "author": "PassFinder 팀"})
doc.save(out, garbage=4, deflate=True)
print(out, os.path.getsize(out), "bytes", len(lecture["pages"]), "pages")
