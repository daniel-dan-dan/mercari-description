'use strict';

(() => {
  const GAS_URL = String(globalThis.MercariPublicConfig?.gasUrl || '').trim();
  const PAIRING_KEY = 'mercari_api_auth_token';
  const DEVICE_ID_KEY = 'mercari_device_id_v1';
  const DEVICE_TOKEN_KEY = 'mercari_device_auth_v1';
  const PENDING_ID_KEY = 'mercari_pending_device_id_v1';
  const PENDING_TOKEN_KEY = 'mercari_pending_device_auth_v1';
  const PENDING_REVOKE_IDS_KEY = 'mercari_pending_revoke_device_ids_v1';
  const GAS_URL_KEY = 'gasUrl';
  const MAC_URL_KEY = 'mercari_mac_service_url_cache';
  const status = document.getElementById('pair-status');
  const retry = document.getElementById('pair-retry');
  const open = document.getElementById('pair-open');
  const params = new URLSearchParams(location.hash.slice(1));
  const pairingCode = String(params.get('token') || '').trim();

  // 接続コードをブラウザ履歴、画面共有、リファラーへ残さない。
  history.replaceState(null, '', `${location.pathname}${location.search}`);

  const isValidPairingCode = value => (
    value.length >= 24
    && value.length <= 512
    && /^[A-Za-z0-9._~-]+$/.test(value)
  );
  const isValidDeviceId = value => /^[A-Za-z0-9._~-]{16,128}$/.test(value);
  const isValidDeviceToken = value => /^[A-Za-z0-9._~-]{32,256}$/.test(value);

  const readPendingRevokeIds = () => {
    try {
      const parsed = JSON.parse(localStorage.getItem(PENDING_REVOKE_IDS_KEY) || '[]');
      if (!Array.isArray(parsed)) return [];
      return [...new Set(parsed.map(value => String(value || '').trim()).filter(isValidDeviceId))]
        .slice(0, 20);
    } catch (_) {
      return [];
    }
  };

  const writePendingRevokeIds = ids => {
    const normalized = [...new Set((ids || [])
      .map(value => String(value || '').trim())
      .filter(isValidDeviceId))]
      .slice(0, 20);
    if (normalized.length) localStorage.setItem(PENDING_REVOKE_IDS_KEY, JSON.stringify(normalized));
    else localStorage.removeItem(PENDING_REVOKE_IDS_KEY);
    return normalized;
  };

  if (!GAS_URL || !isValidPairingCode(pairingCode)) {
    status.textContent = '接続コードが見つかりません。新しいQRコードを読み取ってください。';
    status.className = 'status error';
    return;
  }

  const randomBase64Url = byteLength => {
    if (!crypto?.getRandomValues) throw new Error('安全な端末情報を作成できません');
    const bytes = new Uint8Array(byteLength);
    crypto.getRandomValues(bytes);
    let binary = '';
    bytes.forEach(byte => { binary += String.fromCharCode(byte); });
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
  };

  const operationId = label => {
    const suffix = crypto?.randomUUID ? crypto.randomUUID() : randomBase64Url(18);
    return String(label || 'pair').replace(/[^A-Za-z0-9._:-]+/g, '-').slice(0, 40)
      + ':' + suffix;
  };

  const fingerprint = async token => {
    if (!crypto?.subtle || typeof TextEncoder !== 'function') {
      throw new Error('端末鍵の安全確認に対応していないブラウザです');
    }
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
    return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0'))
      .join('')
      .slice(0, 12);
  };

  const getPendingCredential = () => {
    const savedId = String(localStorage.getItem(PENDING_ID_KEY) || '').trim();
    const savedToken = String(localStorage.getItem(PENDING_TOKEN_KEY) || '').trim();
    if (isValidDeviceId(savedId) && isValidDeviceToken(savedToken)) {
      return { deviceId: savedId, deviceToken: savedToken };
    }
    // 再接続時は新しい端末IDと鍵を作り、登録確認後に旧端末IDを即時失効する。
    const deviceId = `mercari-${randomBase64Url(18)}`;
    const deviceToken = `dev_${randomBase64Url(48)}`;
    localStorage.setItem(PENDING_ID_KEY, deviceId);
    localStorage.setItem(PENDING_TOKEN_KEY, deviceToken);
    return { deviceId, deviceToken };
  };

  const normalizeMacUrl = value => {
    try {
      const parsed = new URL(String(value || '').trim());
      if (parsed.protocol !== 'https:'
          || !/^[a-z0-9-]+\.trycloudflare\.com$/i.test(parsed.hostname)
          || parsed.username || parsed.password || parsed.search || parsed.hash
          || !/^\/?$/.test(parsed.pathname)) return '';
      return parsed.origin;
    } catch (_) {
      return '';
    }
  };

  const fetchWithTimeout = async (url, options, timeoutMs = 15000) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetch(url, {
        cache: 'no-store',
        credentials: 'omit',
        referrerPolicy: 'no-referrer',
        ...options,
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
  };

  const readJson = async (response, label) => {
    const text = await response.text();
    try {
      return text ? JSON.parse(text) : {};
    } catch (_) {
      throw new Error(`${label}の応答を安全に確認できませんでした`);
    }
  };

  const verifyRegisteredDevice = async (macUrl, credential, expectedFingerprint) => {
    const auditOperationId = operationId('pair-list-devices');
    const response = await fetchWithTimeout(`${macUrl}/auth/devices`, {
      headers: {
        'Authorization': `Bearer ${credential.deviceToken}`,
        'X-Operation-Id': auditOperationId,
      },
    });
    const data = await readJson(response, '端末登録確認');
    const current = Array.isArray(data.devices)
      ? data.devices.find(device => String(device.device_id || '') === credential.deviceId)
      : null;
    if (!response.ok || data.ok !== true || !current
        || data.auditRecorded !== true || String(data.operationId || '') !== auditOperationId) {
      throw new Error(data.error || '登録した端末を読み戻して確認できませんでした');
    }
    if (String(current.fingerprint || '') !== expectedFingerprint) {
      throw new Error('登録した端末鍵の確認結果が一致しません');
    }
  };

  const revokePreviousDevice = async (macUrl, credential, previousId) => {
    if (!isValidDeviceId(previousId) || previousId === credential.deviceId) return false;
    const auditOperationId = operationId('pair-revoke-device');
    const response = await fetchWithTimeout(`${macUrl}/auth/revoke-device`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${credential.deviceToken}`,
        'X-Operation-Id': auditOperationId,
      },
      body: JSON.stringify({ device_id: previousId }),
    });
    const data = await readJson(response, '旧端末失効');
    if (!response.ok || data.ok !== true || data.revoked !== true
        || data.auditRecorded !== true || String(data.operationId || '') !== auditOperationId) {
      throw new Error(data.error || '以前の端末鍵を失効できませんでした');
    }
    return true;
  };

  const isDeviceStillRegistered = async (macUrl, credential, deviceId) => {
    const auditOperationId = operationId('pair-list-after-revoke');
    const response = await fetchWithTimeout(`${macUrl}/auth/devices`, {
      headers: {
        'Authorization': `Bearer ${credential.deviceToken}`,
        'X-Operation-Id': auditOperationId,
      },
    });
    const data = await readJson(response, '失効後の端末確認');
    if (!response.ok || data.ok !== true || !Array.isArray(data.devices)
        || data.auditRecorded !== true || String(data.operationId || '') !== auditOperationId) {
      throw new Error(data.error || '失効後の端末一覧を確認できませんでした');
    }
    return data.devices.some(device => String(device.device_id || '') === deviceId);
  };

  const retryPendingRevocations = async (macUrl, credential) => {
    const failed = [];
    for (const deviceId of readPendingRevokeIds()) {
      if (deviceId === credential.deviceId) continue;
      try {
        await revokePreviousDevice(macUrl, credential, deviceId);
      } catch (error) {
        console.warn('以前の端末鍵の失効を後回しにしました:', error);
        try {
          if (!(await isDeviceStillRegistered(macUrl, credential, deviceId))) continue;
        } catch (readbackError) {
          console.warn('失効後の端末一覧も確認できませんでした:', readbackError);
        }
        failed.push(deviceId);
      }
    }
    writePendingRevokeIds(failed);
    return failed;
  };

  const register = async () => {
    const credential = getPendingCredential();
    const previousId = String(localStorage.getItem(DEVICE_ID_KEY) || '').trim();
    const previousToken = String(localStorage.getItem(DEVICE_TOKEN_KEY) || '').trim();
    const expectedFingerprint = await fingerprint(credential.deviceToken);

    const gasResponse = await fetchWithTimeout(GAS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({
        action: 'registerMercariDevice',
        auth_token: pairingCode,
        device_id: credential.deviceId,
        device_token: credential.deviceToken,
      }),
    });
    const gasData = await readJson(gasResponse, 'GAS端末接続');
    if (!gasResponse.ok || gasData.success !== true || gasData.data?.registered !== true) {
      throw new Error(gasData.error || 'GASへ端末情報を登録できませんでした');
    }
    if (String(gasData.data.device_id || '') !== credential.deviceId) {
      throw new Error('GASの端末確認結果が一致しません');
    }
    const macUrl = normalizeMacUrl(gasData.data.url);
    if (!macUrl) throw new Error('Macのメルカリ自動入力サービスが起動していません');

    const registerOperationId = operationId('pair-register-device');
    const macResponse = await fetchWithTimeout(`${macUrl}/auth/register-device`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${pairingCode}`,
        'X-Operation-Id': registerOperationId,
      },
      body: JSON.stringify({
        device_id: credential.deviceId,
        device_token: credential.deviceToken,
      }),
    });
    const macData = await readJson(macResponse, 'Mac端末接続');
    if (!macResponse.ok || macData.ok !== true || macData.registered !== true
        || macData.auditRecorded !== true || String(macData.operationId || '') !== registerOperationId) {
      throw new Error(macData.error || 'Macへ端末情報を登録できませんでした');
    }
    if (String(macData.device_id || '') !== credential.deviceId
        || String(macData.fingerprint || '') !== expectedFingerprint) {
      throw new Error('Macの端末鍵確認結果が一致しません');
    }
    await verifyRegisteredDevice(macUrl, credential, expectedFingerprint);

    try {
      localStorage.setItem(DEVICE_ID_KEY, credential.deviceId);
      localStorage.setItem(DEVICE_TOKEN_KEY, credential.deviceToken);
      if (localStorage.getItem(DEVICE_ID_KEY) !== credential.deviceId
          || localStorage.getItem(DEVICE_TOKEN_KEY) !== credential.deviceToken) {
        throw new Error('端末専用の接続情報を保存できませんでした');
      }
    } catch (error) {
      if (previousId) localStorage.setItem(DEVICE_ID_KEY, previousId);
      else localStorage.removeItem(DEVICE_ID_KEY);
      if (previousToken) localStorage.setItem(DEVICE_TOKEN_KEY, previousToken);
      else localStorage.removeItem(DEVICE_TOKEN_KEY);
      throw error;
    }

    let rotationWarning = '';
    if (isValidDeviceId(previousId) && previousId !== credential.deviceId) {
      writePendingRevokeIds([...readPendingRevokeIds(), previousId]);
    }
    const failedRevocations = await retryPendingRevocations(macUrl, credential);
    if (failedRevocations.length) {
      rotationWarning = '新しい鍵への更新は完了しましたが、以前の鍵の失効は次回接続時に自動再試行します。';
    }

    localStorage.removeItem(PENDING_ID_KEY);
    localStorage.removeItem(PENDING_TOKEN_KEY);
    localStorage.removeItem(PAIRING_KEY);
    if (String(localStorage.getItem('daniel_route_device_auth_v1') || '').trim()) {
      localStorage.removeItem('daniel_api_auth_token');
    }
    localStorage.setItem(GAS_URL_KEY, GAS_URL);
    localStorage.setItem(MAC_URL_KEY, macUrl);
    return { rotationWarning };
  };

  const attempt = async () => {
    retry.hidden = true;
    open.hidden = true;
    status.textContent = 'この端末を安全に接続し、登録結果を確認しています...';
    status.className = 'status';
    try {
      const result = await register();
      status.textContent = result.rotationWarning
        ? result.rotationWarning
        : 'この端末を安全に接続しました。以前の端末鍵も失効済みです。今後の通常更新では再入力不要です。';
      status.className = result.rotationWarning ? 'status warn' : 'status success';
      open.hidden = false;
    } catch (error) {
      console.warn('端末接続に失敗しました:', error);
      status.textContent = `${error.message || '端末を接続できませんでした'}。接続情報は消さず、もう一度試せます。`;
      status.className = 'status error';
      retry.hidden = false;
    }
  };

  retry.addEventListener('click', attempt);
  attempt();
})();
