# Local foreground model

`u2netp.onnx` is the lightweight U²-Net model distributed by rembg. It runs on the device to create an editable foreground mask; no uploaded product photo is sent to a model service.

- Source: https://github.com/danielgatis/rembg/releases/download/v0.0.0/u2netp.onnx
- Preprocessing reference: https://github.com/danielgatis/rembg/blob/main/rembg/sessions/u2netp.py and `sessions/base.py` (verified 2026-10-07).
- Original project/license: https://github.com/xuebinqin/U-2-Net — Apache-2.0, reproduced in `LICENSE`.
- Bytes: 4,574,861
- MD5 (rembg reference): `8e83ca70e441ab06c318d82300c84806`
- SHA-256: `309c8469258dda742793dce0ebea8e6dd393174f89934733ecc8b14c76f4ddd8`

The model may omit pale fur, thin edges or include props. The user reviews the result and can restore/erase the mask before adding a new photo. The input photos remain intact.
