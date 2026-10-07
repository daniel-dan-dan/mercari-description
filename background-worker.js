'use strict';
// Everything is served from this app's origin. No photo or credentials leave the device.
importScripts('vendor/onnxruntime/ort.wasm.min.js');
self.onmessage = async event => {
  let session;
  try {
    self.postMessage({ progress: '切り抜きを準備しています…初回は少し時間がかかります' });
    ort.env.wasm.numThreads = 1;
    ort.env.wasm.proxy = false;
    ort.env.wasm.wasmPaths = new URL('vendor/onnxruntime/', self.location.href).href;
    session = await ort.InferenceSession.create(new URL('models/u2netp.onnx', self.location.href).href, { executionProviders: ['wasm'] });
    const bytes = new Uint8ClampedArray(event.data.pixels), n = 320 * 320;
    if (bytes.length !== n * 4) throw Error('写真データを読み取れませんでした');
    let maximum = 1;
    for (let i = 0; i < n; i++) for (let c = 0; c < 3; c++) maximum = Math.max(maximum, bytes[i * 4 + c]);
    const mean = [0.485, 0.456, 0.406], std = [0.229, 0.224, 0.225], tensor = new Float32Array(n * 3);
    for (let c = 0; c < 3; c++) for (let i = 0; i < n; i++) tensor[c * n + i] = (bytes[i * 4 + c] / maximum - mean[c]) / std[c];
    self.postMessage({ progress: '服を切り抜いています…' });
    const output = await session.run({ [session.inputNames[0]]: new ort.Tensor('float32', tensor, [1, 3, 320, 320]) });
    const data = new Float32Array(output[session.outputNames[0]].data);
    self.postMessage({ mask: data.buffer }, [data.buffer]);
  } catch (error) {
    console.error('背景テンプレートの切り抜きに失敗:', error?.message);
    self.postMessage({ error: '切り抜きを完了できませんでした。通信を確認してもう一度お試しください' });
  } finally { if (session) await session.release(); }
};
