(() => {
  const urlInput = document.getElementById('url');
  const fileInput = document.getElementById('file');
  const uploadBox = document.getElementById('uploadBox');
  const uploadHint = document.getElementById('uploadHint');
  const preview = document.getElementById('preview');
  const figmaUrlInput = document.getElementById('figmaUrl');
  const figmaHint = document.getElementById('figmaHint');
  const sourceTabs = document.querySelectorAll('.source-tabs .tab');
  const vwInput = document.getElementById('vw');
  const vhInput = document.getElementById('vh');
  const runBtn = document.getElementById('runBtn');
  const statusEl = document.getElementById('status');
  const resultCard = document.getElementById('resultCard');
  const resetBtn = document.getElementById('resetBtn');
  const diffPctEl = document.getElementById('diffPct');
  const dimsEl = document.getElementById('dims');
  const tabs = document.querySelectorAll('.result-tabs .tab');
  const images = {
    diffImg: document.getElementById('diffImg'),
    capturedImg: document.getElementById('capturedImg'),
    referenceImg: document.getElementById('referenceImg'),
  };

  let imageDataUrl = null;
  let referenceSource = 'upload';

  sourceTabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      sourceTabs.forEach((t) => t.classList.remove('active'));
      tab.classList.add('active');
      referenceSource = tab.dataset.source;
      const isFigma = referenceSource === 'figma';
      uploadBox.style.display = isFigma ? 'none' : 'block';
      figmaUrlInput.style.display = isFigma ? 'block' : 'none';
      figmaHint.style.display = isFigma ? 'block' : 'none';
    });
  });

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

  function resetAll() {
    urlInput.value = '';
    fileInput.value = '';
    imageDataUrl = null;
    preview.src = '';
    preview.classList.remove('show');
    uploadBox.classList.remove('has-file');
    uploadHint.textContent = '탭해서 이미지 선택 (PNG/JPG)';
    figmaUrlInput.value = '';
    referenceSource = 'upload';
    sourceTabs.forEach((t) => t.classList.remove('active'));
    sourceTabs[0].classList.add('active');
    uploadBox.style.display = 'block';
    figmaUrlInput.style.display = 'none';
    figmaHint.style.display = 'none';
    vwInput.value = 1920;
    vhInput.value = 1080;
    resultCard.style.display = 'none';
    Object.values(images).forEach((img) => {
      img.src = '';
      img.classList.remove('show');
    });
    images.diffImg.classList.add('show');
    tabs.forEach((t) => t.classList.remove('active'));
    tabs[0].classList.add('active');
    setStatus('');
  }

  resetBtn.addEventListener('click', resetAll);

  runBtn.addEventListener('click', async () => {
    const url = urlInput.value.trim();
    const figmaUrl = figmaUrlInput.value.trim();
    if (!url) return setStatus('URL을 입력해주세요.', true);
    if (referenceSource === 'figma' && !figmaUrl) return setStatus('Figma 링크를 입력해주세요.', true);
    if (referenceSource === 'upload' && !imageDataUrl) return setStatus('기준 스크린샷을 업로드해주세요.', true);

    runBtn.disabled = true;
    setStatus('페이지를 캡처하고 비교하는 중... (최대 30초)');
    resultCard.style.display = 'none';

    try {
      const res = await fetch('/api/compare', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url,
          image: referenceSource === 'upload' ? imageDataUrl : undefined,
          figmaUrl: referenceSource === 'figma' ? figmaUrl : undefined,
          viewportWidth: Number(vwInput.value) || 1920,
          viewportHeight: Number(vhInput.value) || 1080,
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
