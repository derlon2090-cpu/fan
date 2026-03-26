let model = null;
let modelReady = false;
let authToken = localStorage.getItem('artToken') || '';
let currentUser = null;
let latestEvaluation = null;
let currentImageDataUrl = '';

const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d', { willReadFrequently: true });

function escapeHtml(value = '') {
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function showToast(message) {
    alert(message);
}

let galleryState = [];

function api(path, options = {}) {
    const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
    if (authToken) headers.Authorization = `Bearer ${authToken}`;
    return fetch(path, { ...options, headers }).then(async (response) => {
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || 'حدث خطأ في الاتصال بالسيرفر');
        return data;
    });
}

function scoreDimension(value, ideal, spread) {
    const distance = Math.abs(value - ideal);
    return Math.round(Math.min(100, Math.max(20, 100 - ((distance / spread) * 70))));
}

function buildSubjectFallback(stats) {
    if (stats.warmthRatio > 0.46) return 'مشهد دافئ أو بورتريه تعبيري';
    if (stats.coolRatio > 0.46) return 'مشهد هادئ بارد أو لقطة معمارية';
    if (stats.sharpness > 36) return 'مشهد تفصيلي غني بالعناصر';
    return 'تكوين فني متوازن';
}

function goToLoginPage() {
    window.location.href = '/login.html';
}

function goToProfile() {
    const section = document.getElementById('profileSection');
    if (section) section.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

async function loadModel() {
    try {
        model = await mobilenet.load({ version: 1, alpha: 0.5 });
        modelReady = true;
        document.getElementById('modelStatus').textContent = 'التحليل الذكي المتقدم جاهز الآن، مع بقاء التحليل السريع فوريًا.';
        document.getElementById('modelStatus').className = 'text-xs bg-emerald-100 text-emerald-700 px-3 py-2 rounded-full font-bold';
    } catch (error) {
        document.getElementById('modelStatus').textContent = 'تعذر تحميل النموذج المتقدم، وسيستمر التحليل السريع من دون تعطيل.';
        document.getElementById('modelStatus').className = 'text-xs bg-amber-100 text-amber-700 px-3 py-2 rounded-full font-bold';
    }
}

function toggleAuthPanel() {
    document.getElementById('authPanel').classList.toggle('hidden');
}

async function bootstrap() {
    await fetchGallery();
    await restoreSession();
    loadModel();
}

async function restoreSession() {
    if (!authToken) {
        renderAuthState();
        return;
    }
    try {
        const data = await api('/api/me');
        currentUser = data.user;
        renderAuthState();
        renderProfile(data.user, data.myArtworks);
        if (currentUser.role === 'admin') await loadAdminOverview();
    } catch (error) {
        authToken = '';
        localStorage.removeItem('artToken');
        currentUser = null;
        renderAuthState();
    }
}

function renderAuthState() {
    const authState = document.getElementById('authState');
    const logoutBtn = document.getElementById('logoutBtn');
    const authToggleBtn = document.getElementById('authToggleBtn');
    if (currentUser) {
        authState.classList.remove('hidden');
        authState.textContent = `${currentUser.name} | ${currentUser.email}`;
        logoutBtn.classList.remove('hidden');
        authToggleBtn.textContent = 'الحساب';
        authToggleBtn.onclick = goToProfile;
    } else {
        authState.classList.add('hidden');
        logoutBtn.classList.add('hidden');
        authToggleBtn.textContent = 'الدخول / إنشاء حساب';
        authToggleBtn.onclick = goToLoginPage;
        renderProfile(null, []);
    }
}

async function register() {
    try {
        const data = await api('/api/register', {
            method: 'POST',
            body: JSON.stringify({
                name: document.getElementById('registerName').value.trim(),
                email: document.getElementById('registerEmail').value.trim(),
                password: document.getElementById('registerPassword').value
            })
        });
        authToken = data.token;
        localStorage.setItem('artToken', authToken);
        currentUser = data.user;
        renderAuthState();
        renderProfile(data.user, []);
        document.getElementById('authPanel').classList.add('hidden');
        showToast('تم إنشاء الحساب وتسجيل الدخول بنجاح.');
    } catch (error) {
        showToast(error.message);
    }
}

async function login() {
    try {
        const data = await api('/api/login', {
            method: 'POST',
            body: JSON.stringify({
                email: document.getElementById('loginEmail').value.trim(),
                password: document.getElementById('loginPassword').value
            })
        });
        authToken = data.token;
        localStorage.setItem('artToken', authToken);
        currentUser = data.user;
        renderAuthState();
        renderProfile(data.user, data.myArtworks);
        document.getElementById('authPanel').classList.add('hidden');
        if (currentUser.role === 'admin') await loadAdminOverview();
        showToast('تم تسجيل الدخول.');
    } catch (error) {
        showToast(error.message);
    }
}

function logout() {
    authToken = '';
    currentUser = null;
    localStorage.removeItem('artToken');
    renderAuthState();
    document.getElementById('adminSection').classList.add('hidden');
    showToast('تم تسجيل الخروج.');
}

function renderProfile(user, artworks) {
    const profileCard = document.getElementById('profileCard');
    const myWorks = document.getElementById('myWorks');
    const profileRankPill = document.getElementById('profileRankPill');
    if (!user) {
        profileCard.innerHTML = '<p class=\"text-slate-500\">لم يتم تسجيل الدخول بعد.</p>';
        myWorks.innerHTML = '<div class=\"rounded-2xl bg-white p-4 text-slate-500\">سجّل الدخول لرؤية أعمالك.</div>';
        profileRankPill.textContent = 'ضيف';
        return;
    }
    profileRankPill.textContent = user.rank;
    profileCard.innerHTML = `
        <div class="grid grid-cols-2 gap-3">
            <div class="rounded-2xl bg-slate-50 p-4"><div class="text-slate-500 text-sm">الاسم</div><div class="font-black text-slate-900">${escapeHtml(user.name)}</div></div>
            <div class="rounded-2xl bg-slate-50 p-4"><div class="text-slate-500 text-sm">الإيميل</div><div class="font-black text-slate-900 break-all">${escapeHtml(user.email)}</div></div>
            <div class="rounded-2xl bg-amber-50 p-4"><div class="text-amber-700 text-sm">النقاط</div><div class="font-black text-amber-900">${user.points}</div></div>
            <div class="rounded-2xl bg-emerald-50 p-4"><div class="text-emerald-700 text-sm">الرتبة</div><div class="font-black text-emerald-900">${escapeHtml(user.rank)}</div></div>
        </div>
        <div class="mt-4 rounded-2xl bg-slate-950 p-4 text-white">
            <div class="font-black text-teal-200">رحلة الفنان</div>
            <div class="mt-3 text-sm text-slate-300">${artworks.length ? `عدد الأعمال المحفوظة: ${artworks.length}، وآخر تحديث فني بتاريخ ${new Date(artworks[0].createdAt).toLocaleDateString('ar-SA')}.` : 'ابدأ أول عمل لك، وسيظهر هنا خط تطورك الفني داخل المنصة.'}</div>
        </div>
    `;
    myWorks.innerHTML = artworks.length ? artworks.map((art) => `
        <div class="rounded-2xl bg-white p-4 shadow border border-slate-100">
            <div class="flex items-center justify-between gap-3">
                <div><div class="font-black text-slate-900">${escapeHtml(art.title)}</div><div class="text-xs text-slate-500">${new Date(art.createdAt).toLocaleString('ar-SA')}</div></div>
                <div class="rounded-full bg-teal-100 px-3 py-1 text-sm font-black text-teal-800">${art.score}%</div>
            </div>
            <div class="mt-3 text-sm text-slate-600">المستوى: ${art.level}</div>
        </div>
    `).join('') : '<div class=\"rounded-2xl bg-white p-4 text-slate-500\">لا توجد أعمال محفوظة بعد.</div>';
}

function analyzeImage(canvasEl, context) {
    const { width, height } = canvasEl;
    const pixels = context.getImageData(0, 0, width, height).data;
    const sampleStep = 8;
    let totalBrightness = 0;
    let totalContrast = 0;
    let warmCount = 0;
    let coolCount = 0;
    let edgeScore = 0;
    let centerEnergy = 0;
    let thirdsEnergy = 0;
    let saturationTotal = 0;

    for (let y = 0; y < height; y += sampleStep) {
        for (let x = 0; x < width; x += sampleStep) {
            const i = (y * width + x) * 4;
            const r = pixels[i];
            const g = pixels[i + 1];
            const b = pixels[i + 2];
            const brightness = (r + g + b) / 3;
            const max = Math.max(r, g, b);
            const min = Math.min(r, g, b);
            const sat = max === 0 ? 0 : ((max - min) / max) * 100;
            totalBrightness += brightness;
            totalContrast += max - min;
            saturationTotal += sat;
            if (r > b + 12) warmCount++;
            if (b > r + 12) coolCount++;

            const nextX = Math.min(x + sampleStep, width - 1);
            const nextY = Math.min(y + sampleStep, height - 1);
            const ix = (y * width + nextX) * 4;
            const iy = (nextY * width + x) * 4;
            const nearbyX = (pixels[ix] + pixels[ix + 1] + pixels[ix + 2]) / 3;
            const nearbyY = (pixels[iy] + pixels[iy + 1] + pixels[iy + 2]) / 3;
            edgeScore += Math.abs(brightness - nearbyX) + Math.abs(brightness - nearbyY);

            const nx = x / width;
            const ny = y / height;
            if (nx > 0.33 && nx < 0.66 && ny > 0.33 && ny < 0.66) centerEnergy += brightness + sat;
            if (Math.abs(nx - 0.33) < 0.08 || Math.abs(nx - 0.66) < 0.08 || Math.abs(ny - 0.33) < 0.08 || Math.abs(ny - 0.66) < 0.08) thirdsEnergy += brightness + sat;
        }
    }

    const totalSamples = Math.ceil(width / sampleStep) * Math.ceil(height / sampleStep);
    return {
        brightness: totalBrightness / totalSamples,
        contrast: totalContrast / totalSamples,
        saturation: saturationTotal / totalSamples,
        warmthRatio: warmCount / totalSamples,
        coolRatio: coolCount / totalSamples,
        sharpness: edgeScore / totalSamples,
        centerWeight: centerEnergy / totalSamples,
        thirdsWeight: thirdsEnergy / totalSamples
    };
}

function analyzeGrid(canvasEl, context, rows = 3, cols = 3) {
    const cellWidth = Math.floor(canvasEl.width / cols);
    const cellHeight = Math.floor(canvasEl.height / rows);
    const cells = [];

    for (let row = 0; row < rows; row++) {
        for (let col = 0; col < cols; col++) {
            const x = col * cellWidth;
            const y = row * cellHeight;
            const width = col === cols - 1 ? canvasEl.width - x : cellWidth;
            const height = row === rows - 1 ? canvasEl.height - y : cellHeight;
            const data = context.getImageData(x, y, width, height).data;
            let brightness = 0;
            let contrast = 0;
            let saturation = 0;
            let samples = 0;

            for (let i = 0; i < data.length; i += 32) {
                const r = data[i];
                const g = data[i + 1];
                const b = data[i + 2];
                const max = Math.max(r, g, b);
                const min = Math.min(r, g, b);
                brightness += (r + g + b) / 3;
                contrast += max - min;
                saturation += max === 0 ? 0 : ((max - min) / max) * 100;
                samples++;
            }

            const avgBrightness = brightness / samples;
            const avgContrast = contrast / samples;
            const avgSaturation = saturation / samples;
            let note = 'متوازنة بصريًا وتخدم المشهد.';
            if (avgBrightness < 90) note = 'غامقة وتحتاج إبرازًا أكبر للتفاصيل.';
            else if (avgBrightness > 195) note = 'ساطعة بقوة وتحتاج تهدئة في الإضاءة.';
            else if (avgContrast < 38) note = 'ناعمة أكثر من اللازم وتحتاج فصلًا أوضح.';
            else if (avgSaturation > 70) note = 'ملونة بقوة وقد تستفيد من تهذيب التشبع.';

            cells.push({
                row,
                col,
                x,
                y,
                width,
                height,
                avgBrightness: Math.round(avgBrightness),
                avgContrast: Math.round(avgContrast),
                avgSaturation: Math.round(avgSaturation),
                note
            });
        }
    }

    return cells;
}

function drawGridOverlay(cells) {
    ctx.save();
    ctx.lineWidth = 2;
    ctx.font = 'bold 20px Cairo';
    cells.forEach((cell, index) => {
        ctx.strokeStyle = 'rgba(45, 212, 191, 0.92)';
        ctx.fillStyle = 'rgba(15, 23, 42, 0.42)';
        ctx.strokeRect(cell.x, cell.y, cell.width, cell.height);
        ctx.fillRect(cell.x + 10, cell.y + 10, 56, 34);
        ctx.fillStyle = '#ffffff';
        ctx.fillText(`${index + 1}`, cell.x + 28, cell.y + 33);
    });
    ctx.restore();
}

function buildAdvice(topObject, stats) {
    if (topObject.includes('person') || topObject.includes('face')) return 'العنصر البشري حاضر بقوة، وسيكون أقوى مع ضبط الخلفية واتجاه الضوء على الوجه.';
    if (topObject.includes('landscape') || topObject.includes('mountain') || topObject.includes('tree')) return 'المشهد الطبيعي يستفيد من فصل أفضل بين المقدمة والبعيد حتى يظهر العمق بشكل أوضح.';
    if (topObject.includes('building') || topObject.includes('tower')) return 'التكوين المعماري يحتاج مراقبة الخطوط المستقيمة والمساحات الجانبية حتى يبقى أكثر هيبة.';
    if (stats.saturation > 60) return 'التشبع قوي وجذاب، لكن تهذيب بعض الألوان الثانوية سيرفع فخامة المشهد.';
    return `الصورة تميل إلى "${topObject}"، ومن المفيد رفع وضوح نقطة التركيز وتقليل ازدحام الحواف.`;
}

function buildWeaknessSummary(scores, stats) {
    const weaknesses = [];
    if (scores.lightingScore < 82) weaknesses.push('الإضاءة تحتاج تنظيمًا أوضح وإبرازًا أدق للتفاصيل.');
    if (scores.contrastScore < 82) weaknesses.push('التباين أقل من المطلوب ويضعف الفصل بين العناصر.');
    if (scores.colorScore < 82) weaknesses.push('الألوان تحتاج تهذيبًا أو توازنًا أفضل بين الدرجات.');
    if (scores.compositionScore < 82) weaknesses.push('التكوين لا يقود العين بقوة كافية إلى مركز العمل.');
    if (scores.sharpnessScore < 82) weaknesses.push('الحدة منخفضة نسبيًا وبعض المناطق تبدو رخوة.');
    if (!weaknesses.length) weaknesses.push('لا توجد سلبية حادة، لكن تحسين الإيقاع البصري سيمنح العمل حضورًا أعلى.');

    const directFix = stats.centerWeight > stats.thirdsWeight * 1.4
        ? 'انقل الثقل قليلًا بعيدًا عن المنتصف وامنح الموضوع مساحة تنفس.'
        : 'زد نقطة التركيز الرئيسية وقلل التشتت في الأطراف.';

    return {
        weaknesses,
        directFix
    };
}

function buildProfessionalCritique(scores, topObject, confidence) {
    const compositionComment = scores.composition >= 85
        ? 'التكوين منظم ويقود العين جيدًا.'
        : 'التكوين يحتاج ترتيبًا أوضح لمركز الاهتمام.';
    const colorComment = scores.color >= 85
        ? 'الألوان متماسكة وتخدم الجو العام.'
        : 'الألوان تحتاج تهذيبًا أو انسجامًا أكبر.';
    const conceptComment = confidence >= 80
        ? `الفكرة البصرية واضحة نسبيًا ويظهر موضوعها كـ ${topObject}.`
        : 'الفكرة الحالية تحتاج رمزًا أوضح أو رسالة أكثر مباشرة.';
    const executionComment = scores.execution >= 85
        ? 'التنفيذ مضبوط ومقنع بصريًا.'
        : 'التنفيذ يحتاج صقلًا أكثر في المعالجة والوضوح.';
    return [
        { title: 'Composition', score: scores.composition, comment: compositionComment },
        { title: 'Color Theory', score: scores.color, comment: colorComment },
        { title: 'Concept', score: scores.concept, comment: conceptComment },
        { title: 'Execution', score: scores.execution, comment: executionComment }
    ];
}

async function runCritique(img) {
    document.getElementById('analysisBox').classList.remove('hidden');
    document.getElementById('scanLine').classList.remove('hidden');
    document.getElementById('results').innerHTML = '<p class="text-teal-100">جارٍ تحليل العمل بصريًا...</p>';
    document.getElementById('certificateSection').classList.add('hidden');
    document.getElementById('certificateBtn').classList.add('hidden');
    document.getElementById('scoreBadge').classList.add('hidden');

    canvas.width = 800;
    canvas.height = Math.max(420, Math.round((img.height / img.width) * 800));
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    const stats = analyzeImage(canvas, ctx);
    const gridCells = analyzeGrid(canvas, ctx);
    drawGridOverlay(gridCells);
    currentImageDataUrl = canvas.toDataURL('image/jpeg', 0.92);
    let topObject = buildSubjectFallback(stats);
    let confidence = 55;

    if (modelReady) {
        try {
            const predictions = await model.classify(canvas);
            if (predictions[0]) {
                topObject = predictions[0].className.split(',')[0];
                confidence = Math.round(predictions[0].probability * 100);
            }
        } catch (error) {
            console.error(error);
        }
    }

    const compositionScore = scoreDimension(stats.thirdsWeight, 42, 22);
    const lightingScore = scoreDimension(stats.brightness, 148, 56);
    const contrastScore = scoreDimension(stats.contrast, 80, 35);
    const colorScore = scoreDimension(stats.saturation, 48, 25);
    const sharpnessScore = scoreDimension(stats.sharpness, 34, 18);
    const balanceScore = scoreDimension(Math.abs(stats.centerWeight - stats.thirdsWeight), 6, 18);
    const finalScore = Math.min(100, Math.max(35, Math.round((compositionScore + lightingScore + contrastScore + colorScore + sharpnessScore + balanceScore) / 6)));
    const weaknessSummary = buildWeaknessSummary({ compositionScore, lightingScore, contrastScore, colorScore, sharpnessScore }, stats);
    const digitalArtScores = {
        composition: compositionScore,
        lighting: lightingScore,
        color: colorScore,
        depth: scoreDimension(Math.abs(stats.warmthRatio - stats.coolRatio) * 100 + stats.contrast, 72, 32),
        detail: sharpnessScore,
        visualIdentity: scoreDimension((stats.saturation + stats.contrast) / 2, 58, 24),
        concept: scoreDimension((confidence + stats.contrast + stats.saturation) / 3, 68, 24),
        execution: scoreDimension((sharpnessScore + lightingScore + contrastScore) / 3, 84, 18)
    };
    const professionalCritique = buildProfessionalCritique(digitalArtScores, topObject, confidence);

    latestEvaluation = {
        title: document.getElementById('artTitle').value.trim() || 'عمل فني جديد',
        topObject,
        confidence,
        stats,
        gridCells,
        digitalArtScores,
        professionalCritique,
        scores: { compositionScore, lightingScore, contrastScore, colorScore, sharpnessScore, balanceScore, finalScore },
        notes: [
            `النتيجة العامة ${finalScore}%، والموضوع الأقرب هو: ${topObject} بدقة ${confidence}%.`,
            `أبرز النواقص: ${weaknessSummary.weaknesses.join(' ')}`,
            `التطوير المباشر: ${weaknessSummary.directFix}`,
            `تقييم الفن الرقمي: تكوين ${digitalArtScores.composition}/100، إضاءة ${digitalArtScores.lighting}/100، لون ${digitalArtScores.color}/100، عمق ${digitalArtScores.depth}/100، تفاصيل ${digitalArtScores.detail}/100، هوية بصرية ${digitalArtScores.visualIdentity}/100.`,
            `النقد الاحترافي: ${professionalCritique.map((item) => `${item.title} ${item.score}/100 - ${item.comment}`).join(' | ')}`,
            `النقد المميز: ${buildAdvice(topObject, stats)}`,
            'فكرة تطوير ذكية: جهّز نسخة للنشر ونسخة للطباعة، ولا تستخدم نفس المعالجة اللونية لكليهما.',
            ...gridCells.map((cell, index) => `المربع ${index + 1}: إضاءة ${cell.avgBrightness}%، تباين ${cell.avgContrast}%، تشبع ${cell.avgSaturation}%، والملاحظة: ${cell.note}`)
        ]
    };

    renderCritique();
}

function renderCritique() {
    const results = document.getElementById('results');
    const scoreBadge = document.getElementById('scoreBadge');
    const { notes, scores, professionalCritique } = latestEvaluation;
    const proCards = `
        <div class="grid grid-cols-1 md:grid-cols-2 gap-3 mb-4">
            ${professionalCritique.map((item) => `
                <div class="rounded-2xl bg-white/5 p-3 border border-white/10">
                    <div class="flex items-center justify-between gap-3">
                        <span class="font-black text-teal-200">${item.title}</span>
                        <span class="rounded-full bg-orange-500/20 px-3 py-1 text-xs font-black text-orange-200">${item.score}/100</span>
                    </div>
                    <p class="mt-2 text-xs text-slate-200">${item.comment}</p>
                </div>
            `).join('')}
        </div>
    `;
    const layeredRead = `
        <div class="grid grid-cols-1 gap-3 mb-4">
            <div class="rounded-2xl bg-white/5 p-4 border border-white/10"><div class="text-xs text-[#d6d1c7] mb-1">👁️ الانطباع الأول</div><div class="text-sm text-slate-100">${escapeHtml(notes[0] || '')}</div></div>
            <div class="rounded-2xl bg-white/5 p-4 border border-white/10"><div class="text-xs text-[#d6d1c7] mb-1">🧠 التحليل</div><div class="text-sm text-slate-100">${escapeHtml(notes[3] || '')}</div></div>
            <div class="rounded-2xl bg-white/5 p-4 border border-white/10"><div class="text-xs text-[#d6d1c7] mb-1">🎯 الرسالة</div><div class="text-sm text-slate-100">${escapeHtml(notes[4] || '')}</div></div>
            <div class="rounded-2xl bg-white/5 p-4 border border-white/10"><div class="text-xs text-[#d6d1c7] mb-1">🛠️ الملاحظات التقنية</div><div class="text-sm text-slate-100">${escapeHtml(notes[1] || '')}</div></div>
        </div>
    `;
    results.innerHTML = proCards + layeredRead + notes.map((note, index) => `
        <div class="border-r-2 border-teal-400 pr-4 py-1">
            <p class="text-slate-100">${escapeHtml(note)}</p>
        </div>
    `).join('');
    scoreBadge.textContent = `${scores.finalScore}%`;
    scoreBadge.classList.remove('hidden');
    document.getElementById('scanLine').classList.add('hidden');

    if (scores.finalScore >= 98 && currentUser) {
        document.getElementById('certificateBtn').classList.remove('hidden');
        document.getElementById('certificateSection').classList.remove('hidden');
        document.getElementById('certificateName').textContent = currentUser.name;
        document.getElementById('certificateScore').textContent = `${scores.finalScore}%`;
        document.getElementById('certificateText').textContent = `تُمنح هذه الشهادة إلى ${currentUser.name} بعد تحقيق تقييم ${scores.finalScore}% في تحليل نقدي فني شامل للتكوين والضوء والحدة واللغة البصرية للعمل.`;
        document.getElementById('certificateDate').textContent = `تاريخ الإصدار: ${new Date().toLocaleDateString('ar-SA', { year: 'numeric', month: 'long', day: 'numeric' })}`;
        document.getElementById('analysisHint').textContent = 'العمل بلغ مستوى الشهادة. يمكنك تحميل PDF وحفظ العمل في حسابك.';
        setTimeout(() => downloadCertificate(true), 350);
    } else {
        document.getElementById('certificateSection').classList.add('hidden');
        document.getElementById('certificateBtn').classList.add('hidden');
        document.getElementById('analysisHint').textContent = !currentUser
            ? 'التحليل جاهز، لكن حفظ العمل والشهادة يحتاجان تسجيل الدخول.'
            : `النتيجة الحالية ${scores.finalScore}%. الشهادة تبقى مخفية حتى يصل العمل إلى 98% أو أكثر.`;
    }
}

function downloadCertificate(auto = false) {
    if (!currentUser || !latestEvaluation || latestEvaluation.scores.finalScore < 98) {
        if (!auto) showToast('الشهادة لا تظهر ولا تُحمَّل إلا بعد تسجيل الدخول ووصول التقييم إلى 98% فأعلى.');
        return;
    }
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
    doc.setFillColor(248, 244, 235);
    doc.rect(0, 0, 297, 210, 'F');
    doc.setDrawColor(15, 118, 110);
    doc.setLineWidth(2.3);
    doc.rect(10, 10, 277, 190);
    doc.setDrawColor(194, 65, 12);
    doc.setLineWidth(0.8);
    doc.rect(16, 16, 265, 178);
    doc.setTextColor(25, 35, 45);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(28);
    doc.text('ArtExpert Vision', 148.5, 34, { align: 'center' });
    doc.setFontSize(21);
    doc.text('Certificate of Artistic Excellence', 148.5, 50, { align: 'center' });
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(14);
    doc.text('Awarded to', 148.5, 72, { align: 'center' });
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(24);
    doc.text(currentUser.name, 148.5, 90, { align: 'center' });
    doc.setFontSize(13);
    doc.setFont('helvetica', 'normal');
    doc.text(`For achieving a visual critique score of ${latestEvaluation.scores.finalScore}%`, 148.5, 108, { align: 'center' });
    doc.text(`Detected subject: ${latestEvaluation.topObject}`, 148.5, 119, { align: 'center' });
    doc.text(`Issued on ${new Date().toLocaleDateString('en-GB')}`, 148.5, 130, { align: 'center' });
    doc.save(`certificate-${currentUser.name.replace(/\\s+/g, '-')}.pdf`);
    if (!auto) showToast('تم تحميل الشهادة PDF.');
}

async function saveArtwork() {
    if (!currentUser) {
        showToast('سجّل الدخول أولًا لحفظ العمل داخل السيرفر والملف الشخصي.');
        return;
    }
    if (!latestEvaluation || !currentImageDataUrl) {
        showToast('ارفع صورة أولًا ثم احفظها.');
        return;
    }
    try {
        await api('/api/artworks', {
            method: 'POST',
            body: JSON.stringify({
                title: latestEvaluation.title,
                imageData: currentImageDataUrl,
                analysis: latestEvaluation
            })
        });
        showToast('تم حفظ العمل في السيرفر وربطه بحسابك.');
        const me = await api('/api/me');
        currentUser = me.user;
        renderAuthState();
        renderProfile(me.user, me.myArtworks);
        await fetchGallery();
        if (currentUser.role === 'admin') await loadAdminOverview();
    } catch (error) {
        showToast(error.message);
    }
}

async function fetchGallery() {
    try {
        const data = await api('/api/gallery', { method: 'GET', headers: {} });
        galleryState = data.artworks;
        renderGallery(data.artworks);
        renderLeaderboard(data.leaderboard);
        renderCompareWorks(data.artworks);
    } catch (error) {
        console.error(error);
    }
}

function renderLeaderboard(users) {
    const leaderboard = document.getElementById('leaderboard');
    leaderboard.innerHTML = users.length ? users.map((user, index) => `
        <div class="rounded-2xl bg-white p-4 shadow border border-slate-100">
            <div class="flex items-center justify-between gap-4">
                <div>
                    <div class="font-black text-slate-900">${index + 1}. ${escapeHtml(user.name)}</div>
                    <div class="text-sm text-slate-500">${escapeHtml(user.rank)}</div>
                </div>
                <div class="text-left">
                    <div class="font-black text-amber-700">${user.points} نقطة</div>
                    <div class="text-xs text-slate-500">${user.artworksCount} أعمال</div>
                </div>
            </div>
        </div>
    `).join('') : '<div class="rounded-2xl bg-white p-4 text-slate-500">لا توجد بيانات بعد.</div>';
}

function renderGallery(artworks) {
    const gallery = document.getElementById('gallery');
    gallery.innerHTML = artworks.length ? artworks.map((art) => `
        <article class="art-card soft-zoom rounded-[2rem] bg-white p-4 md:p-5 shadow-xl border border-slate-100">
            <img src="${art.imageData}" alt="${escapeHtml(art.title)}" class="w-full h-72 object-cover rounded-[1.5rem]">
            <div class="mt-4 flex items-start justify-between gap-4">
                <div>
                    <h3 class="text-xl font-black text-slate-900">${escapeHtml(art.title)}</h3>
                    <p class="text-sm text-slate-500 mt-1">بواسطة <button onclick="openArtistProfile('${art.owner.id}')" class="font-bold text-[#8b0000] hover:underline">${escapeHtml(art.owner.name)}</button> | ${escapeHtml(art.owner.rank)}</p>
                </div>
                <div class="text-left">
                    <div class="rounded-full bg-teal-100 px-3 py-1 text-sm font-black text-teal-800">${art.score}%</div>
                    <div class="mt-2 rounded-full bg-amber-100 px-3 py-1 text-xs font-black text-amber-800">${escapeHtml(art.level)}</div>
                </div>
            </div>
            <div class="mt-4 rounded-2xl bg-[#171412] p-4 text-white">
                <div class="grid md:grid-cols-4 gap-3">
                    <div><div class="text-xs text-[#d6d1c7]">الانطباع الأول</div><div class="mt-1 text-sm">${escapeHtml(art.analysis.notes[0] || '')}</div></div>
                    <div><div class="text-xs text-[#d6d1c7]">التحليل</div><div class="mt-1 text-sm">${escapeHtml(art.analysis.notes[3] || '')}</div></div>
                    <div><div class="text-xs text-[#d6d1c7]">الرسالة</div><div class="mt-1 text-sm">${escapeHtml(art.analysis.notes[4] || '')}</div></div>
                    <div><div class="text-xs text-[#d6d1c7]">الملاحظات التقنية</div><div class="mt-1 text-sm">${escapeHtml(art.analysis.notes[1] || '')}</div></div>
                </div>
            </div>
            <div class="mt-4 grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                <div class="rounded-2xl bg-slate-50 p-3"><span class="text-slate-500">التكوين</span><div class="font-black">${art.analysis.scores.compositionScore}%</div></div>
                <div class="rounded-2xl bg-slate-50 p-3"><span class="text-slate-500">الإضاءة</span><div class="font-black">${art.analysis.scores.lightingScore}%</div></div>
                <div class="rounded-2xl bg-slate-50 p-3"><span class="text-slate-500">التباين</span><div class="font-black">${art.analysis.scores.contrastScore}%</div></div>
                <div class="rounded-2xl bg-slate-50 p-3"><span class="text-slate-500">الحدة</span><div class="font-black">${art.analysis.scores.sharpnessScore}%</div></div>
            </div>
            <div class="mt-4 grid grid-cols-2 md:grid-cols-3 gap-3 text-sm">
                <div class="rounded-2xl bg-teal-50 p-3"><span class="text-slate-500">عمق بصري</span><div class="font-black">${art.analysis.digitalArtScores?.depth ?? '--'}/100</div></div>
                <div class="rounded-2xl bg-teal-50 p-3"><span class="text-slate-500">الهوية البصرية</span><div class="font-black">${art.analysis.digitalArtScores?.visualIdentity ?? '--'}/100</div></div>
                <div class="rounded-2xl bg-teal-50 p-3"><span class="text-slate-500">اللون</span><div class="font-black">${art.analysis.digitalArtScores?.color ?? art.analysis.scores.colorScore}/100</div></div>
            </div>
            <div class="mt-4 grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                <div class="rounded-2xl bg-slate-50 p-3"><span class="text-slate-500">Concept</span><div class="font-black">${art.analysis.digitalArtScores?.concept ?? '--'}/100</div></div>
                <div class="rounded-2xl bg-slate-50 p-3"><span class="text-slate-500">Execution</span><div class="font-black">${art.analysis.digitalArtScores?.execution ?? '--'}/100</div></div>
                <div class="rounded-2xl bg-slate-50 p-3"><span class="text-slate-500">Color Theory</span><div class="font-black">${art.analysis.digitalArtScores?.color ?? '--'}/100</div></div>
                <div class="rounded-2xl bg-slate-50 p-3"><span class="text-slate-500">Composition</span><div class="font-black">${art.analysis.digitalArtScores?.composition ?? '--'}/100</div></div>
            </div>
            <div class="mt-4 rounded-2xl bg-slate-950 p-4 text-white">
                <div class="font-black text-teal-200 mb-2">ملخص النقد</div>
                <p class="text-sm leading-8">${escapeHtml(art.analysis.notes[1] || art.analysis.notes[0])}</p>
            </div>
            <div class="mt-4 grid md:grid-cols-2 gap-4">
                <div class="rounded-2xl border border-slate-100 p-4 bg-slate-50">
                    <div class="font-black text-slate-900">نقد الجمهور</div>
                    <div class="mt-3 grid grid-cols-2 gap-2 text-sm">
                        <button onclick="reactToArtwork('${art.id}','understood')" class="rounded-2xl bg-white px-3 py-2 border">👍 فهمت الفكرة (${art.reactionStats?.understood ?? 0})</button>
                        <button onclick="reactToArtwork('${art.id}','deep')" class="rounded-2xl bg-white px-3 py-2 border">🤯 عميق (${art.reactionStats?.deep ?? 0})</button>
                        <button onclick="reactToArtwork('${art.id}','creative')" class="rounded-2xl bg-white px-3 py-2 border">🎨 إبداعي (${art.reactionStats?.creative ?? 0})</button>
                        <button onclick="reactToArtwork('${art.id}','unclear')" class="rounded-2xl bg-white px-3 py-2 border">❌ غير واضح (${art.reactionStats?.unclear ?? 0})</button>
                    </div>
                </div>
                <div class="rounded-2xl border border-slate-100 p-4 bg-slate-50">
                    <div class="font-black text-slate-900">هل أتفق مع الناقد؟</div>
                    <div class="mt-3 flex flex-wrap gap-2 text-sm">
                        <button onclick="voteCritique('${art.id}','agree')" class="rounded-2xl bg-white px-3 py-2 border">👍 أتفق (${art.critiqueVoteStats?.agree ?? 0})</button>
                        <button onclick="voteCritique('${art.id}','partial')" class="rounded-2xl bg-white px-3 py-2 border">🤔 جزئيًا (${art.critiqueVoteStats?.partial ?? 0})</button>
                        <button onclick="voteCritique('${art.id}','disagree')" class="rounded-2xl bg-white px-3 py-2 border">❌ لا (${art.critiqueVoteStats?.disagree ?? 0})</button>
                    </div>
                </div>
            </div>
            <div class="mt-4">
                <div class="flex items-center justify-between">
                    <h4 class="font-black text-slate-900">نقد الجمهور والنقاشات</h4>
                    <span class="text-xs text-slate-500">${art.comments.length} رد</span>
                </div>
                <div class="mt-3 space-y-3">
                    ${art.comments.length ? art.comments.map((comment) => `
                        <div class="rounded-2xl border border-slate-100 bg-slate-50 p-4">
                            <div class="flex items-center justify-between gap-4">
                                <div>
                                    <div class="font-black text-slate-900">${escapeHtml(comment.user.name)} <span class="text-xs text-slate-500">| ${escapeHtml(comment.user.rank)}</span></div>
                                    <div class="text-xs text-slate-500">${comment.kind === 'edit' ? 'اقتراح تعديل' : 'تعليق نقدي'} | +${comment.pointsAwarded} نقطة</div>
                                </div>
                                ${currentUser && (currentUser.role === 'admin' || currentUser.id === comment.user.id) ? `<div class="flex gap-2"><button onclick="editComment('${comment.id}','${escapeHtml(comment.text)}')" class="rounded-xl bg-amber-500 px-3 py-2 text-xs font-black text-white">تعديل</button><button onclick="removeComment('${comment.id}')" class="rounded-xl bg-rose-600 px-3 py-2 text-xs font-black text-white">حذف</button></div>` : ''}
                            </div>
                            <p class="mt-3 text-sm leading-8 text-slate-700">${escapeHtml(comment.text)}</p>
                        </div>
                    `).join('') : '<div class="rounded-2xl bg-slate-50 p-4 text-slate-500">لا توجد تعليقات بعد.</div>'}
                </div>
                <div class="mt-4 grid md:grid-cols-[1fr_auto_auto] gap-3">
                    <textarea id="comment-${art.id}" rows="2" placeholder="أضف تعليقًا أو اقتراح تعديل لهذا العمل" class="w-full rounded-2xl border border-slate-200 px-4 py-3"></textarea>
                    <button onclick="addComment('${art.id}','comment',${art.score})" class="rounded-2xl bg-slate-900 px-4 py-3 text-white font-black">تعليق</button>
                    <button onclick="addComment('${art.id}','edit',${art.score})" class="rounded-2xl bg-teal-700 px-4 py-3 text-white font-black">تعديل مقترح</button>
                </div>
            </div>
        </article>
    `).join('') : '<div class="rounded-[2rem] bg-white p-6 text-slate-500">لا توجد أعمال في المعرض بعد.</div>';
}

function renderCompareWorks(artworks) {
    const compareWorks = document.getElementById('compareWorks');
    if (!compareWorks) return;
    const pair = artworks.slice(0, 2);
    if (pair.length < 2) {
        compareWorks.innerHTML = '<div class="rounded-2xl bg-white p-4 text-slate-500">تحتاج المنصة إلى عملين على الأقل لعرض المقارنة.</div>';
        return;
    }
    compareWorks.innerHTML = pair.map((art) => `
        <div class="rounded-2xl bg-white p-4 border border-slate-100 shadow">
            <img src="${art.imageData}" alt="${escapeHtml(art.title)}" class="w-full h-56 object-cover rounded-2xl">
            <div class="mt-4 font-black text-slate-900">${escapeHtml(art.title)}</div>
            <div class="text-sm text-slate-500 mt-1">${escapeHtml(art.owner.name)}</div>
            <div class="mt-4 space-y-2 text-sm">
                <div class="flex justify-between"><span>Concept</span><span class="font-black">${art.analysis.digitalArtScores?.concept ?? '--'}/100</span></div>
                <div class="flex justify-between"><span>Execution</span><span class="font-black">${art.analysis.digitalArtScores?.execution ?? '--'}/100</span></div>
                <div class="flex justify-between"><span>Identity</span><span class="font-black">${art.analysis.digitalArtScores?.visualIdentity ?? '--'}/100</span></div>
            </div>
        </div>
    `).join('');
}

async function reactToArtwork(artworkId, type) {
    if (!currentUser) return showToast('سجل الدخول أولًا للتفاعل.');
    try {
        await api('/api/reactions', { method: 'POST', body: JSON.stringify({ artworkId, type }) });
        await fetchGallery();
    } catch (error) {
        showToast(error.message);
    }
}

async function voteCritique(artworkId, vote) {
    if (!currentUser) return showToast('سجل الدخول أولًا للتصويت.');
    try {
        await api('/api/critique-votes', { method: 'POST', body: JSON.stringify({ artworkId, vote }) });
        await fetchGallery();
    } catch (error) {
        showToast(error.message);
    }
}

async function openArtistProfile(userId) {
    try {
        const data = await api(`/api/profile/${userId}`, { method: 'GET', headers: {} });
        const panel = document.getElementById('artistProfileContent');
        panel.innerHTML = `
            <div class="space-y-4">
                <div class="flex items-start justify-between gap-4">
                    <div>
                        <div class="text-2xl font-black text-slate-900">${escapeHtml(data.user.name)}</div>
                        <div class="text-sm text-slate-500">${escapeHtml(data.user.rank)} | ${data.followersCount} متابع</div>
                    </div>
                    ${currentUser && currentUser.id !== data.user.id ? `<button onclick="toggleFollow('${data.user.id}')" class="rounded-2xl bg-[#8b0000] px-4 py-2 text-white font-black">${data.isFollowing ? 'إلغاء المتابعة' : 'متابعة'}</button>` : ''}
                </div>
                <div class="rounded-2xl bg-slate-950 p-4 text-white">
                    <div class="font-black text-teal-200">رحلة الفنان</div>
                    <div class="mt-2 text-sm text-slate-300">${data.artworks.length ? `بدأ عرض أعماله داخل المنصة بعدد ${data.artworks.length} عمل، ويظهر تطوره من خلال اختلاف الدرجات والهوية البصرية بين الأعمال.` : 'لا توجد أعمال منشورة بعد.'}</div>
                </div>
                <div class="grid md:grid-cols-2 gap-3">
                    ${data.artworks.map((art) => `
                        <div class="rounded-2xl bg-slate-50 p-3 border border-slate-100">
                            <div class="font-black text-slate-900">${escapeHtml(art.title)}</div>
                            <div class="text-xs text-slate-500 mt-1">${art.score}% | ${escapeHtml(art.level)}</div>
                        </div>
                    `).join('')}
                </div>
            </div>
        `;
        document.getElementById('artistProfilePanel').scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (error) {
        showToast(error.message);
    }
}

async function toggleFollow(targetUserId) {
    try {
        await api('/api/follows', { method: 'POST', body: JSON.stringify({ targetUserId }) });
        await openArtistProfile(targetUserId);
        await fetchGallery();
    } catch (error) {
        showToast(error.message);
    }
}

async function addComment(artworkId, kind, score) {
    if (!currentUser) {
        showToast('تحتاج تسجيل الدخول لإضافة تعليق أو تعديل.');
        return;
    }
    const input = document.getElementById(`comment-${artworkId}`);
    const text = input.value.trim();
    if (!text) {
        showToast('اكتب تعليقك أولًا.');
        return;
    }
    try {
        await api('/api/comments', { method: 'POST', body: JSON.stringify({ artworkId, text, kind, score }) });
        input.value = '';
        await fetchGallery();
        const me = await api('/api/me');
        currentUser = me.user;
        renderAuthState();
        renderProfile(me.user, me.myArtworks);
        if (currentUser.role === 'admin') await loadAdminOverview();
        showToast(`تمت إضافة ${kind === 'edit' ? 'اقتراح التعديل' : 'التعليق'} ومنحك نقاطًا.`);
    } catch (error) {
        showToast(error.message);
    }
}

async function removeComment(commentId) {
    try {
        await api(`/api/comments/${commentId}`, { method: 'DELETE' });
        await fetchGallery();
        if (currentUser) {
            const me = await api('/api/me');
            currentUser = me.user;
            renderAuthState();
            renderProfile(me.user, me.myArtworks);
            if (currentUser.role === 'admin') await loadAdminOverview();
        }
        showToast('تم حذف الرد.');
    } catch (error) {
        showToast(error.message);
    }
}

async function editComment(commentId, currentText) {
    const nextText = prompt('عدّل النص', currentText);
    if (nextText === null) return;
    if (!nextText.trim()) {
        showToast('النص لا يمكن أن يكون فارغًا.');
        return;
    }
    try {
        await api(`/api/comments/${commentId}`, { method: 'PATCH', body: JSON.stringify({ text: nextText.trim() }) });
        await fetchGallery();
        if (currentUser && currentUser.role === 'admin') await loadAdminOverview();
        showToast('تم تعديل الرد.');
    } catch (error) {
        showToast(error.message);
    }
}

async function loadAdminOverview() {
    try {
        const data = await api('/api/admin/overview');
        document.getElementById('adminSection').classList.remove('hidden');
        document.getElementById('adminOverview').innerHTML = `
            <div class="rounded-2xl bg-white p-4 shadow"><div class="text-slate-500 text-sm">المستخدمون</div><div class="font-black text-slate-900 text-2xl">${data.stats.users}</div></div>
            <div class="rounded-2xl bg-white p-4 shadow"><div class="text-slate-500 text-sm">الأعمال</div><div class="font-black text-slate-900 text-2xl">${data.stats.artworks}</div></div>
            <div class="rounded-2xl bg-white p-4 shadow"><div class="text-slate-500 text-sm">التعليقات</div><div class="font-black text-slate-900 text-2xl">${data.stats.comments}</div></div>
        `;

        document.getElementById('adminUsers').innerHTML = data.users.map((user) => `
            <div class="rounded-2xl bg-white p-4 border border-slate-100">
                <div class="flex items-center justify-between gap-4">
                    <div>
                        <div class="font-black text-slate-900">${escapeHtml(user.name)}</div>
                        <div class="text-sm text-slate-500 break-all">${escapeHtml(user.email)}</div>
                        <div class="text-xs text-slate-500 mt-1">${escapeHtml(user.rank)} | ${user.points} نقطة | ${user.role === 'admin' ? 'أدمن' : 'مستخدم'}</div>
                    </div>
                    <div class="flex flex-col gap-2">
                        ${user.role !== 'admin' ? `<button onclick="grantPoints('${user.id}')" class="rounded-xl bg-amber-500 px-3 py-2 text-xs font-black text-white">+ نقاط</button>` : ''}
                        ${user.role !== 'admin' ? `<button onclick="removeUser('${user.id}')" class="rounded-xl bg-rose-600 px-3 py-2 text-xs font-black text-white">حذف</button>` : ''}
                    </div>
                </div>
            </div>
        `).join('');

        document.getElementById('adminComments').innerHTML = data.comments.map((comment) => `
            <div class="rounded-2xl bg-white p-4 border border-slate-100">
                <div class="flex items-center justify-between gap-3">
                    <div>
                        <div class="font-black text-slate-900">${escapeHtml(comment.userName)} على ${escapeHtml(comment.artworkTitle)}</div>
                        <div class="text-xs text-slate-500">${comment.kind === 'edit' ? 'اقتراح تعديل' : 'تعليق'} | ${new Date(comment.createdAt).toLocaleString('ar-SA')}</div>
                    </div>
                    <div class="flex gap-2"><button onclick="editComment('${comment.id}','${escapeHtml(comment.text)}')" class="rounded-xl bg-amber-500 px-3 py-2 text-xs font-black text-white">تعديل</button><button onclick="removeComment('${comment.id}')" class="rounded-xl bg-rose-600 px-3 py-2 text-xs font-black text-white">حذف</button></div>
                </div>
                <p class="mt-3 text-sm text-slate-700 leading-8">${escapeHtml(comment.text)}</p>
            </div>
        `).join('');
    } catch (error) {
        showToast(error.message);
    }
}

async function grantPoints(userId) {
    const amount = prompt('كم نقطة تريد إضافتها؟', '25');
    if (!amount) return;
    try {
        await api(`/api/users/${userId}/points`, { method: 'PATCH', body: JSON.stringify({ amount: Number(amount) }) });
        await loadAdminOverview();
        await fetchGallery();
        showToast('تمت إضافة النقاط.');
    } catch (error) {
        showToast(error.message);
    }
}

async function removeUser(userId) {
    if (!confirm('سيتم حذف المستخدم وأعماله وتعليقاته. هل تريد المتابعة؟')) return;
    try {
        await api(`/api/users/${userId}`, { method: 'DELETE' });
        await loadAdminOverview();
        await fetchGallery();
        showToast('تم حذف المستخدم.');
    } catch (error) {
        showToast(error.message);
    }
}

document.getElementById('imgInput').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
        const img = new Image();
        img.onload = () => runCritique(img);
        img.src = event.target.result;
    };
    reader.readAsDataURL(file);
});

bootstrap();
