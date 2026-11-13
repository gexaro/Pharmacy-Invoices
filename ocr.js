
(function () {
  'use strict';

  let app = null;
  let selectedFiles = [];
  let worker = null;
  let lastCandidates = [];
  let lastRawText = '';

  function parseNumber(value) {
    const normalized = String(value)
      .replace(/[٠-٩]/g, digit => String('٠١٢٣٤٥٦٧٨٩'.indexOf(digit)))
      .replace(/[٬،]/g, ',')
      .replace(/٫/g, '.')
      .replace(/,/g, '');

    const number = Number(normalized);
    return Number.isFinite(number) ? number : null;
  }

  function extractCandidates(text) {
    const lines = text.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
    const candidates = [];

    lines.forEach(line => {
      const matches = line.match(/[0-9٠-٩]+(?:[.,٬٫][0-9٠-٩]+)*/g) || [];
      if (matches.length < 2) return;

      const values = matches.map(parseNumber).filter(value => value !== null);
      if (values.length < 2) return;

      const name = line
        .replace(/[0-9٠-٩]+(?:[.,٬٫][0-9٠-٩]+)*/g, ' ')
        .replace(/[|:؛،,]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

      if (!name || name.length < 2) return;

      const unitPrice = values.length >= 3
        ? values[values.length - 2]
        : values[values.length - 1];

      const paidQty = values.length >= 3
        ? values[values.length - 3]
        : values[values.length - 2];

      if (!(paidQty > 0) || !(unitPrice >= 0)) return;

      candidates.push({
        name,
        paidQty: Math.floor(paidQty),
        bonusQty: 0,
        unitPrice,
        sourceLine: line
      });
    });

    return candidates;
  }

  function setProgress(percent, status) {
    const area = document.getElementById('ocrProgressArea');
    const bar = document.getElementById('ocrProgressBar');
    const percentText = document.getElementById('ocrProgressPercent');
    const statusText = document.getElementById('ocrStatusText');

    if (area) area.hidden = false;
    if (bar) bar.style.width = Math.max(0, Math.min(100, percent)) + '%';
    if (percentText) percentText.textContent = Math.round(percent) + '%';
    if (statusText) statusText.textContent = status || 'جارٍ قراءة الصورة...';
  }

  function renderSelectedImages() {
    const preview = document.getElementById('ocrImagePreview');
    const list = document.getElementById('ocrImageList');
    const runButton = document.getElementById('runOcrBtn');

    if (!preview || !list || !runButton) return;

    list.replaceChildren();

    selectedFiles.forEach(file => {
      const image = document.createElement('img');
      image.className = 'ocr-thumb';
      image.alt = file.name || 'صورة فاتورة';

      const imageUrl = URL.createObjectURL(file);
      image.src = imageUrl;

      image.onload = () => URL.revokeObjectURL(imageUrl);
      image.onerror = () => URL.revokeObjectURL(imageUrl);

      list.append(image);
    });

    preview.hidden = selectedFiles.length === 0;
    runButton.disabled = selectedFiles.length === 0;
  }

  function renderReview() {
    const panel = document.getElementById('ocrReviewPanel');
    const list = document.getElementById('ocrReviewList');
    const count = document.getElementById('ocrDetectedCount');
    const raw = document.getElementById('ocrRawText');

    if (!panel || !list) return;

    list.replaceChildren();

    lastCandidates.forEach((candidate, index) => {
      const card = document.createElement('article');
      card.className = 'review-item';

      const title = document.createElement('div');
      title.className = 'review-item-title';

      const label = document.createElement('strong');
      label.textContent = 'صنف ' + (index + 1);

      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'remove-item';
      remove.textContent = '×';
      remove.setAttribute('aria-label', 'حذف الصنف من نتائج القراءة');

      remove.addEventListener('click', () => {
        lastCandidates.splice(index, 1);
        renderReview();
      });

      title.append(label, remove);

      const grid = document.createElement('div');
      grid.className = 'review-item-grid';

      const fields = [
        ['الاسم', 'name', 'text'],
        ['الكمية المدفوعة', 'paidQty', 'number'],
        ['البونص', 'bonusQty', 'number'],
        ['سعر الوحدة', 'unitPrice', 'number']
      ];

      fields.forEach(([caption, key, type]) => {
        const wrapper = document.createElement('label');
        wrapper.className = 'field';

        const text = document.createElement('span');
        text.textContent = caption;

        const input = document.createElement('input');
        input.type = type;

        if (type === 'number') {
          input.min = key === 'paidQty' ? '1' : '0';
          input.step = key === 'unitPrice' ? 'any' : '1';
          input.inputMode = key === 'unitPrice' ? 'decimal' : 'numeric';
        }

        input.value = candidate[key] == null ? '' : String(candidate[key]);

        input.addEventListener('input', () => {
          candidate[key] = type === 'number'
            ? Number(input.value)
            : input.value;
        });

        wrapper.append(text, input);
        grid.append(wrapper);
      });

      card.append(title, grid);
      list.append(card);
    });

    if (count) count.textContent = lastCandidates.length + ' أصناف مقترحة';
    if (raw) raw.textContent = lastRawText;

    panel.hidden = false;
  }

  async function recognizeImages() {
    if (!window.Tesseract || typeof window.Tesseract.createWorker !== 'function') {
      throw new Error('تعذر تحميل محرك OCR. تحقق من اتصال الإنترنت ثم أعد تحميل الصفحة.');
    }

    if (!selectedFiles.length) {
      throw new Error('اختر صورة واحدة على الأقل أولاً.');
    }

    lastCandidates = [];
    lastRawText = '';

    let totalText = '';

    worker = await window.Tesseract.createWorker('ara+eng', 1, {
      logger(message) {
        if (message && typeof message.progress === 'number') {
          const percent = message.status === 'recognizing text'
            ? message.progress * 100
            : Math.min(20, message.progress * 20);

          setProgress(
            percent,
            message.status === 'recognizing text'
              ? 'جارٍ قراءة النصوص...'
              : 'جارٍ تجهيز محرك القراءة...'
          );
        }
      }
    });

    try {
      for (let index = 0; index < selectedFiles.length; index += 1) {
        setProgress(
          (index / selectedFiles.length) * 100,
          'قراءة الصورة ' + (index + 1) + ' من ' + selectedFiles.length
        );

        const result = await worker.recognize(selectedFiles[index]);

        totalText += (
          result && result.data && result.data.text
            ? result.data.text
            : ''
        ) + '\n';
      }
    } finally {
      await worker.terminate();
      worker = null;
    }

    lastRawText = totalText.trim();
    lastCandidates = extractCandidates(lastRawText);

    setProgress(100, 'اكتملت القراءة. راجع النتائج قبل إضافتها.');
    renderReview();

    if (!lastCandidates.length) {
      throw new Error(
        'تم استخراج النص، لكن لم أستطع اقتراح أصناف بثقة. يمكنك مراجعة النص الخام وإدخال الأصناف يدوياً.'
      );
    }

    return lastCandidates;
  }

  function init(PharmacyApp) {
    app = PharmacyApp;

    const input = document.getElementById('invoiceCameraInput');

    document.getElementById('openCameraBtn')?.addEventListener('click', () => {
      input?.click();
    });

    document.getElementById('chooseInvoiceImagesBtn')?.addEventListener('click', () => {
      if (input) {
        input.removeAttribute('capture');
        input.click();
        input.setAttribute('capture', 'environment');
      }
    });

    input?.addEventListener('change', () => {
      selectedFiles = Array.from(input.files || [])
        .filter(file => file.type.startsWith('image/'));

      renderSelectedImages();

      const error = document.getElementById('ocrError');
      if (error) error.hidden = true;
    });

    document.getElementById('clearInvoiceImagesBtn')?.addEventListener('click', () => {
      selectedFiles = [];

      if (input) input.value = '';

      renderSelectedImages();

      const reviewPanel = document.getElementById('ocrReviewPanel');
      if (reviewPanel) reviewPanel.hidden = true;

      lastCandidates = [];
      lastRawText = '';
    });

    document.getElementById('runOcrBtn')?.addEventListener('click', async () => {
      const error = document.getElementById('ocrError');
      if (error) error.hidden = true;

      const button = document.getElementById('runOcrBtn');
      button.disabled = true;

      try {
        await recognizeImages();
      } catch (problem) {
        if (error) {
          error.textContent = problem.message || 'حدث خطأ أثناء قراءة الصور.';
          error.hidden = false;
        }
      } finally {
        button.disabled = selectedFiles.length === 0;
      }
    });

    document.getElementById('addOcrItemsBtn')?.addEventListener('click', () => {
      const valid = lastCandidates.filter(item =>
        typeof item.name === 'string' &&
        item.name.trim() &&
        Number.isInteger(Number(item.paidQty)) &&
        Number(item.paidQty) > 0 &&
        Number.isInteger(Number(item.bonusQty)) &&
        Number(item.bonusQty) >= 0 &&
        Number.isFinite(Number(item.unitPrice)) &&
        Number(item.unitPrice) >= 0
      );

      if (!valid.length) {
        app.toast('لا توجد أصناف صالحة للإضافة. راجع القيم أولاً.');
        return;
      }

      window.PharmacyInvoice.addMany(valid);

      document.getElementById('ocrReviewPanel').hidden = true;

      app.toast('تمت إضافة ' + valid.length + ' أصناف إلى مسودة الفاتورة.');
    });

    document.getElementById('discardOcrBtn')?.addEventListener('click', () => {
      lastCandidates = [];
      document.getElementById('ocrReviewPanel').hidden = true;
    });
  }

  window.PharmacyOCR = Object.freeze({
    init,
    getSelectedFiles: () => selectedFiles.slice()
  });
})();
