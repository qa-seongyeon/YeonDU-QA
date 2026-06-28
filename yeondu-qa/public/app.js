(() => {
  const urlInput = document.getElementById('url');
  const fileInput = document.getElementById('file');
  const uploadBox = document.getElementById('uploadBox');
  const uploadHint = document.getElementById('uploadHint');
  const preview = document.getElementById('preview');
  const vwInput = document.getElementById('vw');
  const vhInput = document.getElementById('vh');
  const runBtn = document.getElementById('runBtn');
  const statusEl = document.getElementById('status');
  const resultCard = document.getElementById('resultCard');
  const diffPctEl = document.getElementById('diffPct');
  const dimsEl = document.getElementById('dims');
  const tabs = document.querySelectorAll('.tab');
  const images = {
    diffImg: document.getElementById('diffImg'),
    capturedImg: document.getElementById('capturedImg'),
    referenceImg: document.getElementById('referenceImg'),
  };

  let imageDataUrl = null;

  fileInput.addEventListener('change', () => {
    const f = fileInput.files[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => {
      imageDataUrl = reader.result;
      preview.src = imageDataUrl;
      preview.classList.add('show');
      uploadBox.classList.add('has-file');
      uploadHint.textContent = f.name;
    };
    reader.readAsDataURL(f);
  });

  tabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      tabs.forEach((t) => t.classList.remove('active'));
      tab.classList.add('active');
      Object.entries(images).forEach(([key, img]) => {
        img.classList.toggle('show', key === tab.dataset.target);
      });
    });
  });

  function setStatus(msg, isError) {
    statusEl.textContent = msg || '';
    statusEl.classList.toggle('error', !!isError);
  }

  function pctClass(pct) {
    if (pct < 1) return 'low';
    if (pct < 5) return 'mid';
    return 'high';
  }

  runBtn.addEventListener('click', async () => {
    const url = urlInput.value.trim();
    if (!url) return setStatus('URL을 입력해주세요.', true);
    if (!imageDataUrl) return setStatus('기준 스크린샷을 업로드해주세요.', true);

    runBtn.disabled = true;
    setStatus('페이지를 캡처하고 비교하는 중... (최대 30초)');
    resultCard.style.display = 'none';

    try {
      const res = await fetch('/api/compare', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url,
          image: imageDataUrl,
          viewportWidth: Number(vwInput.value) || 390,
          viewportHeight: Number(vhInput.value) || 844,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '알 수 없는 오류가 발생했습니다.');

      images.diffImg.src = data.diffUrl + '?t=' + Date.now();
      images.capturedImg.src = data.capturedUrl + '?t=' + Date.now();
      images.referenceImg.src = data.referenceUrl + '?t=' + Date.now();

      diffPctEl.textContent = data.diffPercent + '%';
      diffPctEl.className = 'diff-pct ' + pctClass(data.diffPercent);
      dimsEl.textContent = `${data.width}×${data.height}px`;

      resultCard.style.display = 'block';
      setStatus('완료!');
    } catch (e) {
      setStatus(e.message, true);
    } finally {
      runBtn.disabled = false;
    }
  });
})();
