
(function () {
  'use strict';

  let selectedFiles = [];
  let worker = null;
  let lastCandidates = [];
  let lastRawText = '';
  let pageResults = [];
  let invoiceMismatch = false;
  let reviewWarnings = [];

  const $ = id => document.getElementById(id);

  const COLUMNS = {
    date: [0.095, 0.18],
    batch: [0.18, 0.275],
    value: [0.275, 0.38],
    price: [0.38, 0.463],
    quantity: [0.463, 0.546],
    name: [0.546, 0.883]
  };

  function toast(message) {
    if (window.PharmacyApp?.toast) {
      window.PharmacyApp.toast(message);
    } else {
      alert(message);
    }
  }

  function normalizeDigits(value) {
    return String(value || '')
      .replace(/[٠-٩]/g, digit =>
        String('٠١٢٣٤٥٦٧٨٩'.indexOf(digit))
      )
      .replace(/[۰-۹]/g, digit =>
        String('۰۱۲۳۴۵۶۷۸۹'.indexOf(digit))
      );
  }

  function normalizeName(value) {
    return String(value || '')
      .toLowerCase()
      .replace(/[أإآ]/g, 'ا')
      .replace(/ى/g, 'ي')
      .replace(/[^\p{L}\p{N}]+/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function parseNumber(value) {
    const normalized = normalizeDigits(value)
      .replace(/[٬،,'’‘٫]/g, '')
      .replace(/[^\d.-]/g, '');

    if (!normalized || !/\d/.test(normalized)) {
      return null;
    }

    const number = Number(normalized);

    return Number.isSafeInteger(number) && number >= 0
      ? number
      : null;
  }

  function extractNumbers(value) {
    const matches = normalizeDigits(value)
      .match(/\d[\d,٬.'’٫]*\d|\d/g) || [];

    return matches
      .map(parseNumber)
      .filter(number => number !== null);
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
      statusText.textContent = status || 'جارٍ قراءة الصور...';
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

  function clearError() {
    if ($('ocrError')) {
      $('ocrError').hidden = true;
      $('ocrError').textContent = '';
    }
  }

  function loadImage(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const image = new Image();

      image.onload = () => {
        URL.revokeObjectURL(url);
        resolve(image);
      };

      image.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error('تعذر فتح إحدى الصور المختارة.'));
      };

      image.src = url;
    });
  }

  async function prepareImage(file) {
    const image = await loadImage(file);

    const originalWidth = image.naturalWidth;
    const originalHeight = image.naturalHeight;

    if (!originalWidth || !originalHeight) {
      throw new Error('أبعاد إحدى الصور غير صالحة.');
    }

    // تكبير الصورة قليلاً لتحسين قراءة النصوص الصغيرة.
    const scale = Math.min(
      1.7,
      Math.max(1, 2200 / originalWidth)
    );

    const canvas = document.createElement('canvas');

    canvas.width = Math.round(originalWidth * scale);
    canvas.height = Math.round(originalHeight * scale);

    const context = canvas.getContext('2d', {
      willReadFrequently: true
    });

    if (!context) {
      throw new Error('تعذرت معالجة الصورة داخل المتصفح.');
    }

    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, canvas.width, canvas.height);

    context.drawImage(
      image,
      0,
      0,
      canvas.width,
      canvas.height
    );

    // تحويل إلى تدرج رمادي وتحسين التباين.
    const pixels = context.getImageData(
      0,
      0,
      canvas.width,
      canvas.height
    );

    const data = pixels.data;
    const contrast = 1.22;

    for (let i = 0; i < data.length; i += 4) {
      const gray =
        0.299 * data[i] +
        0.587 * data[i + 1] +
        0.114 * data[i + 2];

      let adjusted =
        (gray - 128) * contrast + 128;

      adjusted = Math.max(
        0,
        Math.min(255, adjusted)
      );

      data[i] = adjusted;
      data[i + 1] = adjusted;
      data[i + 2] = adjusted;
    }

    context.putImageData(pixels, 0, 0);

    return {
      canvas,
      width: canvas.width,
      height: canvas.height
    };
  }

  function renderSelectedImages() {
    const preview = $('ocrImagePreview');
    const list = $('ocrImageList');
    const runButton = $('runOcrBtn');

    if (!preview || !list || !runButton) return;

    list.replaceChildren();

    selectedFiles.forEach((file, index) => {
      const card = document.createElement('div');
      card.className = 'ocr-page-card';

      const image = document.createElement('img');
      image.className = 'ocr-thumb';
      image.alt = 'صفحة ' + (index + 1);

      const url = URL.createObjectURL(file);
      image.src = url;

      image.onload = () => URL.revokeObjectURL(url);
      image.onerror = () => URL.revokeObjectURL(url);

      const label = document.createElement('strong');
      label.className = 'ocr-page-label';
      label.textContent = 'صفحة ' + (index + 1);

      const controls = document.createElement('div');
      controls.className = 'ocr-page-controls';

      const up = document.createElement('button');
      up.type = 'button';
      up.className = 'ocr-page-action';
      up.textContent = '↑';
      up.disabled = index === 0;
      up.setAttribute('aria-label', 'تحريك الصفحة للأعلى');

      up.addEventListener('click', () => {
        if (index === 0) return;

        [
          selectedFiles[index - 1],
          selectedFiles[index]
        ] = [
          selectedFiles[index],
          selectedFiles[index - 1]
        ];

        resetResults();
        renderSelectedImages();
      });

      const down = document.createElement('button');
      down.type = 'button';
      down.className = 'ocr-page-action';
      down.textContent = '↓';
      down.disabled = index === selectedFiles.length - 1;
      down.setAttribute('aria-label', 'تحريك الصفحة للأسفل');

      down.addEventListener('click', () => {
        if (index >= selectedFiles.length - 1) return;

        [
          selectedFiles[index],
          selectedFiles[index + 1]
        ] = [
          selectedFiles[index + 1],
          selectedFiles[index]
        ];

        resetResults();
        renderSelectedImages();
      });

      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'ocr-page-action remove-page';
      remove.textContent = '×';
      remove.setAttribute('aria-label', 'حذف الصفحة');

      remove.addEventListener('click', () => {
        selectedFiles.splice(index, 1);
        resetResults();
        renderSelectedImages();
      });

      controls.append(up, down, remove);
      card.append(image, label, controls);
      list.append(card);
    });

    preview.hidden = selectedFiles.length === 0;

    runButton.disabled =
      selectedFiles.length === 0;
  }

  function resetResults() {
    lastCandidates = [];
    lastRawText = '';
    pageResults = [];
    invoiceMismatch = false;
    reviewWarnings = [];

    if ($('ocrReviewPanel')) {
      $('ocrReviewPanel').hidden = true;
    }

    if ($('ocrProgressArea')) {
      $('ocrProgressArea').hidden = true;
    }

    clearError();
  }

  function parseTSV(tsv, width, height) {
    if (!tsv || typeof tsv !== 'string') {
      return [];
    }

    const lines = tsv.trim().split(/\r?\n/);

    if (lines.length < 2) return [];

    const headers = lines[0].split('\t');

    const index = {};
    headers.forEach((header, i) => {
      index[header.trim()] = i;
    });

    const required = [
      'level',
      'block_num',
      'par_num',
      'line_num',
      'left',
      'top',
      'width',
      'height',
      'conf',
      'text'
    ];

    if (!required.every(key => index[key] !== undefined)) {
      return [];
    }

    const words = [];

    for (let i = 1; i < lines.length; i += 1) {
      const parts = lines[i].split('\t');

      if (Number(parts[index.level]) !== 5) {
        continue;
      }

      const text = String(parts[index.text] || '').trim();

      if (!text) continue;

      const left = Number(parts[index.left]);
      const top = Number(parts[index.top]);
      const wordWidth = Number(parts[index.width]);
      const wordHeight = Number(parts[index.height]);

      if (
        !Number.isFinite(left) ||
        !Number.isFinite(top) ||
        wordWidth <= 0 ||
        wordHeight <= 0
      ) {
        continue;
      }

      words.push({
        text,
        left,
        top,
        width: wordWidth,
        height: wordHeight,
        centerX: (left + wordWidth / 2) / width,
        centerY: (top + wordHeight / 2) / height,
        confidence: Number(parts[index.conf]) || 0,
        block: parts[index.block_num],
        paragraph: parts[index.par_num],
        line: parts[index.line_num]
      });
    }

    return words;
  }

  function groupWordsByLine(words) {
    const groups = new Map();

    words.forEach(word => {
      const key = [
        word.block,
        word.paragraph,
        word.line
      ].join('-');

      if (!groups.has(key)) {
        groups.set(key, []);
      }

      groups.get(key).push(word);
    });

    return Array.from(groups.values())
      .map(group => {
        group.sort((a, b) => a.left - b.left);

        const top = Math.min(
          ...group.map(word => word.top)
        );

        const bottom = Math.max(
          ...group.map(word => word.top + word.height)
        );

        return {
          words: group,
          top,
          bottom,
          centerY: (top + bottom) / 2,
          text: group.map(word => word.text).join(' ')
        };
      })
      .sort((a, b) => a.centerY - b.centerY);
  }

  function extractInvoiceNumber(lines) {
    const headerLines = lines.filter(line =>
      line.centerY < 0.27
    );

    let best = null;
    let bestScore = 0;

    headerLines.forEach(line => {
      const text = normalizeDigits(line.text);

      const hasInvoiceLabel =
        /فاتور|رقم|invoice|inv\b/i.test(text);

      if (!hasInvoiceLabel) return;

      const numbers = extractNumbers(text)
        .filter(number =>
          String(number).length >= 5 &&
          String(number).length <= 10 &&
          !String(number).startsWith('202')
        );

      numbers.forEach(number => {
        const score =
          /فاتور/i.test(text) ? 3 : 2;

        if (score > bestScore) {
          best = String(number);
          bestScore = score;
        }
      });
    });

    return best;
  }

  function extractPrintedTotal(lines, imageHeight) {
    const footerLines = lines.filter(line =>
      line.centerY > 0.58
    );

    let best = null;
    let bestScore = 0;

    footerLines.forEach(line => {
      const text = line.text;

      if (!/اجمال|إجمال|المجموع|total/i.test(text)) {
        return;
      }

      const numbers = extractNumbers(text);

      if (!numbers.length) return;

      const value = Math.max(...numbers);

      if (value <= 0) return;

      const score =
        /اجمال|إجمال/i.test(text) ? 3 : 2;

      if (score > bestScore) {
        best = value;
        bestScore = score;
      }
    });

    return best;
  }

  function findTableBounds(lines, imageHeight) {
    const header = lines.find(line => {
      if (line.centerY > imageHeight * 0.55) {
        return false;
      }

      return (
        /المادة|الكمية|السعر|القيمة/.test(line.text)
      );
    });

    const headerBottom = header
      ? header.bottom
      : imageHeight * 0.245;

    const totalLine = lines.find(line =>
      line.top > headerBottom &&
      line.centerY > imageHeight * 0.52 &&
      /اجمال|إجمال|المجموع|total/i.test(line.text)
    );

    return {
      top: headerBottom + imageHeight * 0.006,
      bottom: totalLine
        ? totalLine.top - imageHeight * 0.004
        : imageHeight * 0.70
    };
  }

  function groupIntoRows(words, imageHeight, bounds) {
    const filtered = words
      .filter(word =>
        word.centerY >= bounds.top / imageHeight &&
        word.centerY <= bounds.bottom / imageHeight
      )
      .sort((a, b) => a.centerY - b.centerY);

    const rows = [];
    const tolerance = 0.009;

    filtered.forEach(word => {
      let row = rows[rows.length - 1];

      if (
        !row ||
        Math.abs(row.centerY - word.centerY) > tolerance
      ) {
        row = {
          words: [],
          centerY: word.centerY
        };

        rows.push(row);
      }

      row.words.push(word);

      row.centerY =
        row.words.reduce(
          (sum, item) => sum + item.centerY,
          0
        ) / row.words.length;
    });

    return rows;
  }

  function wordsInColumn(words, column) {
    const [min, max] = COLUMNS[column];

    return words
      .filter(word =>
        word.centerX >= min &&
        word.centerX < max
      )
      .sort((a, b) => a.left - b.left);
  }

  function readCell(words) {
    if (!words.length) return null;

    const combined = words
      .map(word => word.text)
      .join('');

    const direct = parseNumber(combined);

    if (direct !== null) return direct;

    const values = words
      .map(word => parseNumber(word.text))
      .filter(value => value !== null);

    if (!values.length) return null;

    return values.length === 1
      ? values[0]
      : Number(values.join(''));
  }

  function cleanItemName(words) {
    return words
      .map(word => word.text)
      .join(' ')
      .replace(/[|:؛،]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function extractPageItems(words, lines, imageHeight, pageNumber) {
    const bounds = findTableBounds(lines, imageHeight);

    const rows = groupIntoRows(
      words,
      imageHeight,
      bounds
    );

    const items = [];
    const unresolved = [];

    rows.forEach((row, index) => {
      const nameWords = wordsInColumn(
        row.words,
        'name'
      );

      const quantityWords = wordsInColumn(
        row.words,
        'quantity'
      );

      const priceWords = wordsInColumn(
        row.words,
        'price'
      );

      const valueWords = wordsInColumn(
        row.words,
        'value'
      );

      const name = cleanItemName(nameWords);
      const paidQty = readCell(quantityWords);
      const unitPrice = readCell(priceWords);
      const printedValue = readCell(valueWords);

      if (
        !name ||
        name.length < 2 ||
        !Number.isSafeInteger(paidQty) ||
        paidQty <= 0 ||
        !Number.isSafeInteger(unitPrice) ||
        unitPrice < 0
      ) {
        if (name || quantityWords.length || priceWords.length) {
          unresolved.push({
            page: pageNumber,
            row: index + 1,
            text: row.words.map(word => word.text).join(' ')
          });
        }

        return;
      }

      const item = {
        name,
        normalizedName: normalizeName(name),
        paidQty,
        bonusQty: 0,
        unitPrice,
        printedValue,
        page: pageNumber,
        sourceRows: [{
          page: pageNumber,
          text: row.words.map(word => word.text).join(' '),
          paidQty,
          unitPrice,
          printedValue
        }],
        warning: ''
      };

      const previous = items[items.length - 1];

      // الخلية الفارغة في عمود القيمة تعني بونص،
      // بشرط تطابق اسم المادة مع الصف السابق.
      if (printedValue === null) {
        if (
          previous &&
          previous.normalizedName === item.normalizedName
        ) {
          previous.bonusQty += paidQty;
          previous.sourceRows.push(item.sourceRows[0]);
        } else {
          unresolved.push({
            page: pageNumber,
            row: index + 1,
            text: item.sourceRows[0].text,
            reason: 'قيمة فارغة دون تطابق مؤكد مع الصنف السابق'
          });
        }

        return;
      }

      const calculatedValue = paidQty * unitPrice;

      if (Math.abs(calculatedValue - printedValue) > 1) {
        item.warning =
          'القيمة المطبوعة لا تطابق الكمية × السعر';
      }

      items.push(item);
    });

    return {
      items,
      unresolved,
      bounds
    };
  }

  function comparePages(results) {
    const numbers = results
      .map(result => result.invoiceNumber)
      .filter(Boolean);

    const uniqueNumbers = [...new Set(numbers)];

    invoiceMismatch = uniqueNumbers.length > 1;

    if (invoiceMismatch) {
      reviewWarnings.push(
        'اختلاف رقم الفاتورة بين الصفحات: ' +
        uniqueNumbers.join(' / ') +
        '. لن يسمح بدمج الأصناف.'
      );
    }

    results.forEach((result, index) => {
      if (!result.invoiceNumber) {
        reviewWarnings.push(
          'رقم الفاتورة غير مقروء في الصفحة ' +
          (index + 1) +
          '. يجب التأكد منه يدوياً.'
        );
      }
    });
  }

  function mergePageItems(results) {
    const merged = [];

    results.forEach(result => {
      result.items.forEach(item => {
        merged.push({ ...item });
      });
    });

    return merged;
  }

  function validatePrintedTotal(results, candidates) {
    if (!results.length) return;

    const lastPage = results[results.length - 1];
    const printedTotal = lastPage.printedTotal;

    if (printedTotal === null || printedTotal === undefined) {
      reviewWarnings.push(
        'لم يتمكن القارئ من تحديد الإجمالي المطبوع في الصفحة الأخيرة.'
      );
      return;
    }

    const calculatedTotal = candidates.reduce(
      (sum, item) =>
        sum + item.paidQty * item.unitPrice,
      0
    );

    if (Math.abs(calculatedTotal - printedTotal) > 1) {
      reviewWarnings.push(
        'اختلاف الإجمالي: مجموع الأصناف المقروءة ' +
        calculatedTotal.toLocaleString('en-US') +
        ' د.ع، والإجمالي المطبوع ' +
        printedTotal.toLocaleString('en-US') +
        ' د.ع.'
      );
    } else {
      reviewWarnings.push(
        'الإجمالي المطبوع يطابق مجموع الأصناف المقروءة.'
      );
    }
  }

  function renderReview() {
    const panel = $('ocrReviewPanel');
    const list = $('ocrReviewList');
    const count = $('ocrDetectedCount');
    const raw = $('ocrRawText');
    const hint = $('ocrReviewHint');
    const addButton = $('addOcrItemsBtn');

    if (!panel || !list) return;

    list.replaceChildren();

    lastCandidates.forEach((candidate, index) => {
      const card = document.createElement('article');
      card.className = 'review-item';

      const title = document.createElement('div');
      title.className = 'review-item-title';

      const label = document.createElement('strong');
      label.textContent =
        'صنف ' + (index + 1) +
        ' · صفحة ' + candidate.page;

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
          input.step = '1';
          input.inputMode = 'numeric';
        }

        input.value =
          candidate[key] == null
            ? ''
            : String(candidate[key]);

        input.addEventListener('input', () => {
          candidate[key] = type === 'number'
            ? (
              input.value.trim() === ''
                ? null
                : Number(input.value)
            )
            : input.value;
        });

        wrapper.append(fieldLabel, input);
        grid.append(wrapper);
      });

      card.append(title, grid);

      if (candidate.warning) {
        const warning = document.createElement('p');
        warning.className = 'ocr-row-warning';
        warning.textContent = candidate.warning;
        card.append(warning);
      }

      list.append(card);
    });

    if (count) {
      count.textContent =
        lastCandidates.length + ' أصناف مقترحة';
    }

    if (hint) {
      hint.textContent = reviewWarnings.join(' | ') ||
        'راجع الأصناف قبل الإضافة.';
    }

    if (raw) {
      raw.textContent = lastRawText;
    }

    if (addButton) {
      addButton.disabled = invoiceMismatch;
    }

    panel.hidden = false;
  }

  async function recognizeImages() {
    if (
      !window.Tesseract ||
      typeof window.Tesseract.createWorker !== 'function'
    ) {
      throw new Error(
        'تعذر تحميل محرك OCR. تحقق من اتصال الإنترنت ثم أعد تحميل التطبيق.'
      );
    }

    if (!selectedFiles.length) {
      throw new Error('اختر صور الفاتورة أولاً.');
    }

    resetResults();

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
            const progress =
              message.status === 'recognizing text'
                ? message.progress * 100
                : Math.min(15, message.progress * 15);

            setProgress(
              progress,
              message.status === 'recognizing text'
                ? 'جارٍ تحليل النصوص والأعمدة...'
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
        const pageNumber = index + 1;

        const baseProgress =
          (index / selectedFiles.length) * 100;

        setProgress(
          baseProgress,
          'معالجة الصفحة ' +
          pageNumber +
          ' من ' +
          selectedFiles.length
        );

        const prepared = await prepareImage(
          selectedFiles[index]
        );

        const result = await worker.recognize(
          prepared.canvas,
          {},
          {
            text: true,
            tsv: true
          }
        );

        const text = result?.data?.text || '';

        const words = parseTSV(
          result?.data?.tsv || '',
          prepared.width,
          prepared.height
        );

        const lines = groupWordsByLine(words);

        const invoiceNumber =
          extractInvoiceNumber(lines);

        const printedTotal =
          extractPrintedTotal(
            lines,
            prepared.height
          );

        const extracted = extractPageItems(
          words,
          lines,
          prepared.height,
          pageNumber
        );

        pageResults.push({
          page: pageNumber,
          text,
          invoiceNumber,
          printedTotal,
          items: extracted.items,
          unresolved: extracted.unresolved
        });

        lastRawText +=
          '\n\n========== الصفحة ' +
          pageNumber +
          ' ==========\n' +
          text;

        setProgress(
          ((index + 1) / selectedFiles.length) * 100,
          'اكتملت قراءة الصفحة ' +
          pageNumber +
          ' من ' +
          selectedFiles.length
        );
      }
    } finally {
      if (worker) {
        await worker.terminate();
        worker = null;
      }
    }

    comparePages(pageResults);

    lastCandidates = mergePageItems(pageResults);

    const unresolvedCount = pageResults.reduce(
      (sum, page) => sum + page.unresolved.length,
      0
    );

    if (unresolvedCount) {
      reviewWarnings.push(
        'توجد ' + unresolvedCount +
        ' صفوف لم تُقرأ بثقة كافية، راجع النص الخام.'
      );
    }

    pageResults.forEach(page => {
      page.items.forEach(item => {
        if (item.warning) {
          reviewWarnings.push(
            'تحذير في الصفحة ' + page.page +
            ': ' + item.name
          );
        }
      });
    });

    validatePrintedTotal(
      pageResults,
      lastCandidates
    );

    const firstNumber = pageResults.find(
      page => page.invoiceNumber
    )?.invoiceNumber;

    if (
      firstNumber &&
      $('invoiceNumber') &&
      !$('invoiceNumber').value.trim()
    ) {
      $('invoiceNumber').value = firstNumber;
    }

    setProgress(
      100,
      'اكتملت قراءة جميع الصفحات. راجع النتائج.'
    );

    renderReview();

    if (!lastCandidates.length) {
      throw new Error(
        'لم يتمكن القارئ من استخراج أصناف واضحة. افتح النص الخام لمراجعة ما قرأه.'
      );
    }

    if (invoiceMismatch) {
      showError(
        'توقف الدمج لأن أرقام الفواتير مختلفة بين الصفحات. افصل صور الفواتير ثم أعد المحاولة.'
      );
    }
  }

  function addRecognizedItems() {
    if (invoiceMismatch) {
      toast(
        'لا يمكن دمج صفحات تحمل أرقام فواتير مختلفة.'
      );
      return;
    }

    const missingNumbers = pageResults.filter(
      page => !page.invoiceNumber
    );

    if (missingNumbers.length) {
      const accepted = confirm(
        'تعذر قراءة رقم الفاتورة في صفحة أو أكثر. ' +
        'تأكد بنفسك أن جميع الصور تخص الفاتورة نفسها. ' +
        'هل تريد المتابعة؟'
      );

      if (!accepted) return;
    }

    const valid = lastCandidates.filter(item =>
      typeof item.name === 'string' &&
      item.name.trim() &&
      Number.isSafeInteger(Number(item.paidQty)) &&
      Number(item.paidQty) > 0 &&
      Number.isSafeInteger(Number(item.bonusQty)) &&
      Number(item.bonusQty) >= 0 &&
      Number.isSafeInteger(Number(item.unitPrice)) &&
      Number(item.unitPrice) >= 0
    );

    if (!valid.length) {
      toast('لا توجد أصناف صالحة للإضافة. راجع القيم أولاً.');
      return;
    }

    if (
      !window.PharmacyInvoice ||
      typeof window.PharmacyInvoice.addMany !== 'function'
    ) {
      toast('نظام الفواتير غير جاهز.');
      return;
    }

    try {
      window.PharmacyInvoice.addMany(
        valid.map(item => ({
          name: item.name,
          paidQty: Number(item.paidQty),
          bonusQty: Number(item.bonusQty),
          unitPrice: Number(item.unitPrice)
        }))
      );

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
      const newFiles = Array.from(input.files || [])
        .filter(file =>
          file.type.startsWith('image/')
        );

      let added = 0;

      newFiles.forEach(file => {
        const duplicate = selectedFiles.some(existing =>
          existing.name === file.name &&
          existing.size === file.size &&
          existing.lastModified === file.lastModified
        );

        if (!duplicate) {
          selectedFiles.push(file);
          added += 1;
        }
      });

      input.value = '';

      if (added) {
        resetResults();
        renderSelectedImages();
      }

      if (newFiles.length && !added) {
        toast('الصور المختارة موجودة مسبقاً.');
      }

      clearError();
    });

    $('clearInvoiceImagesBtn')?.addEventListener('click', () => {
      selectedFiles = [];

      if (input) input.value = '';

      resetResults();
      renderSelectedImages();
    });

    $('runOcrBtn')?.addEventListener('click', async () => {
      clearError();

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

    $('addOcrItemsBtn')?.addEventListener(
      'click',
      addRecognizedItems
    );

    $('discardOcrBtn')?.addEventListener('click', () => {
      lastCandidates = [];
      pageResults = [];

      if ($('ocrReviewPanel')) {
        $('ocrReviewPanel').hidden = true;
      }
    });

    renderSelectedImages();
  }

  window.PharmacyOCR = Object.freeze({
    init,
    getSelectedFiles: () => selectedFiles.slice()
  });

  if (document.readyState === 'loading') {
    document.addEventListener(
      'DOMContentLoaded',
      init,
      { once: true }
    );
  } else {
    init();
  }
})();
