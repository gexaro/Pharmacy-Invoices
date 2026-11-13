
(function () {
  'use strict';

  let selectedFiles = [];
  let worker = null;
  let lastCandidates = [];
  let lastRawText = '';

  const $ = id => document.getElementById(id);

  function toast(message) {
    if (window.PharmacyApp?.toast) {
      window.PharmacyApp.toast(message);
    } else {
      alert(message);
    }
  }

  function parseNumber(value) {
    const normalized = String(value)
      .replace(/[٠-٩]/g, digit =>
        String('٠١٢٣٤٥٦٧٨٩'.indexOf(digit))
      )
      .replace(/[٬،]/g, ',')
      .replace(/٫/g, '.')
      .replace(/,/g, '');

    const number = Number(normalized);
    return Number.isFinite(number) ? number : null;
  }

  function extractCandidates(text) {
    const lines = text
      .split(/\r?\n/)
      .map(line => line.trim())
      .filter(Boolean);

    const candidates = [];

    lines.forEach(line => {
      const matches =
        line.match(/[0-9٠-٩]+(?:[.,٬٫][0-9٠-٩]+)*/g) || [];

      if (matches.length < 2) return;

      const values = matches
        .map(parseNumber)
        .filter(value => value !== null);

      if (values.length < 2) return;

      const name = line
        .replace(/[0-9٠-٩]+(?:[.,٬٫][0-9٠-٩]+)*/g, ' ')
        .replace(/[|:؛،,]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

      if (!name || name.length < 2) return;

      // اقتراح مبدئي فقط؛ لا يعتمد دون مراجعة المستخدم.
      const unitPrice = values[values.length - 1];
      const paidQty = values.length >= 3
        ? values[values.length - 2]
        : values[0];

      if (
        !Number.isInteger(paidQty) ||
        paidQty <= 0 ||
        !Number.isFinite(unitPrice) ||
        unitPrice < 0
      ) {
        return;
      }

      candidates.push({
        name,
        paidQty,
        bonusQty: 0,
        unitPrice,
        sourceLine: line
      });
    });

    return candidates;
  }

  function setProgress(percent, status) {
    const area = $('ocrProgressArea');
    const bar = $('ocrProgressBar');
    const percentText = $('ocrProgressPercent');
    const statusText = $('ocrStatusText');

    if (area) area.hidden = false;
    if (bar) {
      bar.style.width =
        Math.max(0, Math.min(100, percent)) + '%';
    }

    if (percentText) {
      percentText.textContent = Math.round(percent) + '%';
    }

    if (statusText) {
      statusText.textContent = status || 'جارٍ قراءة الصورة...';
    }
  }

  function showError(message) {
    const error = $('ocrError');

    if (error) {
      error.textContent = message;
      error.hidden = false;
    } else {
      toast(message);
    }
  }

  function renderSelectedImages() {
    const preview = $('ocrImagePreview');
    const list = $('ocrImageList');
    const runButton = $('runOcrBtn');

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
    const panel = $('ocrReviewPanel');
    const list = $('ocrReviewList');
    const count = $('ocrDetectedCount');
    const raw = $('ocrRawText');

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
      remove.setAttribute(
        'aria-label',
        'حذف الصنف من نتائج القراءة'
      );

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

        const fieldLabel = document.createElement('span');
        fieldLabel.textContent = caption;

        const input = document.createElement('input');
        input.type = type;

        if (type === 'number') {
          input.min = key === 'paidQty' ? '1' : '0';
          input.step = key === 'unitPrice' ? 'any' : '1';
          input.inputMode =
            key === 'unitPrice' ? 'decimal' : 'numeric';
        }

        input.value =
          candidate[key] == null ? '' : String(candidate[key]);

        input.addEventListener('input', () => {
          candidate[key] = type === 'number'
            ? Number(input.value)
            : input.value;
        });

        wrapper.append(fieldLabel, input);
        grid.append(wrapper);
      });

      card.append(title, grid);
      list.append(card);
    });

    if (count) {
      count.textContent = lastCandidates.length + ' أصناف مقترحة';
    }

    if (raw) raw.textContent = lastRawText;

    panel.hidden = false;
  }

  async function recognizeImages() {
    if (
      !window.Tesseract ||
      typeof window.Tesseract.createWorker !== 'function'
    ) {
      throw new Error(
        'تعذر تحميل محرك OCR. تحقق من اتصال الإنترنت ثم أعد تحميل الصفحة.'
      );
    }

    if (!selectedFiles.length) {
      throw new Error('اختر صورة واحدة على الأقل أولاً.');
    }

    lastCandidates = [];
    lastRawText = '';

    let totalText = '';

    setProgress(0, 'جارٍ تشغيل محرك قراءة الفواتير...');

    worker = await window.Tesseract.createWorker(
      'ara+eng',
      1,
      {
        logger(message) {
          if (
            message &&
            typeof message.progress === 'number'
          ) {
            const percent =
              message.status === 'recognizing text'
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
      }
    );

    try {
      for (
        let index = 0;
        index < selectedFiles.length;
        index += 1
      ) {
        setProgress(
          (index / selectedFiles.length) * 100,
          'قراءة الصورة ' +
            (index + 1) +
            ' من ' +
            selectedFiles.length
        );

        const result = await worker.recognize(
          selectedFiles[index]
        );

        totalText += (
          result?.data?.text || ''
        ) + '\n';
      }
    } finally {
      if (worker) {
        await worker.terminate();
        worker = null;
      }
    }

    lastRawText = totalText.trim();
    lastCandidates = extractCandidates(lastRawText);

    setProgress(
      100,
      'اكتملت القراءة. راجع النتائج قبل إضافتها.'
    );

    renderReview();

    if (!lastCandidates.length) {
      throw new Error(
        'تم استخراج النص، لكن لم أستطع اقتراح أصناف مناسبة. راجع النص الخام وأدخل الأصناف يدوياً عند الحاجة.'
      );
    }

    return lastCandidates;
  }

  function init() {
    const input = $('invoiceCameraInput');

    $('openCameraBtn')?.addEventListener('click', () => {
      if (input) {
        input.setAttribute('capture', 'environment');
        input.click();
      }
    });

    $('chooseInvoiceImagesBtn')?.addEventListener('click', () => {
      if (input) {
        input.removeAttribute('capture');
        input.click();
      }
    });

    input?.addEventListener('change', () => {
      selectedFiles = Array.from(input.files || [])
        .filter(file => file.type.startsWith('image/'));

      renderSelectedImages();

      if ($('ocrError')) $('ocrError').hidden = true;
    });

    $('clearInvoiceImagesBtn')?.addEventListener('click', () => {
      selectedFiles = [];

      if (input) input.value = '';

      renderSelectedImages();

      if ($('ocrReviewPanel')) {
        $('ocrReviewPanel').hidden = true;
      }

      if ($('ocrProgressArea')) {
        $('ocrProgressArea').hidden = true;
      }

      lastCandidates = [];
      lastRawText = '';
    });

    $('runOcrBtn')?.addEventListener('click', async () => {
      if ($('ocrError')) $('ocrError').hidden = true;

      const button = $('runOcrBtn');
      if (button) button.disabled = true;

      try {
        await recognizeImages();
      } catch (error) {
        showError(
          error.message || 'حدث خطأ أثناء قراءة الصور.'
        );
      } finally {
        if (button) {
          button.disabled = selectedFiles.length === 0;
        }
      }
    });

    $('addOcrItemsBtn')?.addEventListener('click', () => {
      const valid = lastCandidates.filter(item =>
        typeof item.name === 'string' &&
        item.name.trim() &&
        Number.isSafeInteger(Number(item.paidQty)) &&
        Number(item.paidQty) > 0 &&
        Number.isSafeInteger(Number(item.bonusQty)) &&
        Number(item.bonusQty) >= 0 &&
        Number.isFinite(Number(item.unitPrice)) &&
        Number(item.unitPrice) >= 0
      );

      if (!valid.length) {
        toast('لا توجد أصناف صالحة للإضافة. راجع القيم أولاً.');
        return;
      }

      try {
        if (
          !window.PharmacyInvoice ||
          typeof window.PharmacyInvoice.addMany !== 'function'
        ) {
          throw new Error('نظام الفواتير غير جاهز.');
        }

        window.PharmacyInvoice.addMany(valid);

        if ($('ocrReviewPanel')) {
          $('ocrReviewPanel').hidden = true;
        }

        toast(
          'تمت إضافة ' +
          valid.length +
          ' أصناف إلى مسودة الفاتورة.'
        );
      } catch (error) {
        toast(error.message || 'تعذرت إضافة الأصناف.');
      }
    });

    $('discardOcrBtn')?.addEventListener('click', () => {
      lastCandidates = [];

      if ($('ocrReviewPanel')) {
        $('ocrReviewPanel').hidden = true;
      }
    });
  }

  window.PharmacyOCR = Object.freeze({
    init,
    getSelectedFiles: () => selectedFiles.slice()
  });

  // تشغيل OCR تلقائياً بعد تجهيز الصفحة.
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, {
      once: true
    });
  } else {
    init();
  }
})();
