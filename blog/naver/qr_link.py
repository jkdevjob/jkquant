#!/usr/bin/env python3
"""qr_open.js 가 찍은 qr_full.png 에서 QR 로그인 주소를 꺼내고, 보낼 이미지(qr_crop.png)를 만든다.

폰 하나로 작업하는 사용자는 화면의 QR 을 찍을 수 없어서, 이 주소를 눌러 열거나
qr_crop.png 를 사진에 저장해 네이버 앱 렌즈의 앨범에서 불러온다.
usage: python3 -I qr_link.py [qr_full.png]   (zxing-cpp 가 없으면: pip install -q zxing-cpp)
"""
import sys
import zxingcpp
from PIL import Image

im = Image.open(sys.argv[1] if len(sys.argv) > 1 else 'qr_full.png')
im.crop((150, 150, 750, 560)).save('qr_crop.png')
codes = [c.text for c in zxingcpp.read_barcodes(im)]
if not codes:
    sys.exit('QR not found')
print(codes[0])
