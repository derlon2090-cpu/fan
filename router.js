const crypto = require('crypto');
const { URL } = require('url');
const {
    applyRanks,
    artworkLevel,
    buildArtworksResponse,
    critiqueReward,
    ensureStore,
    getUserFromToken,
    hashPassword,
    isQuadName,
    isStrongPassword,
    rankLabel,
    readStore,
    sanitizeUser,
    writeStore
} = require('./store');

function sendJson(res, statusCode, payload) {
    res.statusCode = statusCode;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
    res.end(JSON.stringify(payload));
}

function parseBody(req) {
    return new Promise((resolve, reject) => {
        let body = '';
        req.on('data', (chunk) => { body += chunk; });
        req.on('end', () => {
            if (!body) return resolve({});
            try {
                resolve(JSON.parse(body));
            } catch (error) {
                reject(new Error('تعذر قراءة البيانات المرسلة'));
            }
        });
        req.on('error', reject);
    });
}

module.exports = async (req, res) => {
    ensureStore();
    if (req.method === 'OPTIONS') {
        sendJson(res, 200, { ok: true });
        return;
    }

    try {
        const url = new URL(req.url, 'http://localhost');
        const apiPath = url.pathname.replace(/^\/api/, '') || '/';
        const store = readStore();
        applyRanks(store);
        const currentUser = getUserFromToken(store, req);

        if (req.method === 'GET' && apiPath === '/gallery') {
            const artworks = buildArtworksResponse(store);
            const leaderboard = store.users
                .slice()
                .sort((a, b) => b.points - a.points)
                .slice(0, 10)
                .map((user) => ({
                    ...sanitizeUser(user),
                    artworksCount: store.artworks.filter((art) => art.userId === user.id).length
                }));
            writeStore(store);
            sendJson(res, 200, { artworks, leaderboard });
            return;
        }

        if (req.method === 'POST' && apiPath === '/register') {
            const body = await parseBody(req);
            const name = String(body.name || '').trim();
            const email = String(body.email || '').trim().toLowerCase();
            const password = String(body.password || '');
            if (!name || !email || !email.includes('@')) return sendJson(res, 400, { error: 'الاسم الكامل والبريد الإلكتروني الصحيح مطلوبان.' });
            if (!isQuadName(name)) return sendJson(res, 400, { error: 'الاسم الرباعي مطلوب ليظهر كاملًا في الشهادة.' });
            if (!isStrongPassword(password)) return sendJson(res, 400, { error: 'كلمة المرور يجب أن تكون قوية: 10 أحرف على الأقل وتشمل حرفًا كبيرًا وصغيرًا ورقمًا ورمزًا.' });
            if (store.users.some((user) => user.email === email)) return sendJson(res, 400, { error: 'هذا الإيميل مستخدم بالفعل.' });
            const user = { id: crypto.randomUUID(), name, email, passwordHash: hashPassword(password), role: 'user', points: 0, rank: rankLabel(0), createdAt: new Date().toISOString() };
            store.users.push(user);
            const token = crypto.randomBytes(24).toString('hex');
            store.sessions[token] = user.id;
            writeStore(store);
            sendJson(res, 201, { token, user: sanitizeUser(user) });
            return;
        }

        if (req.method === 'POST' && apiPath === '/login') {
            const body = await parseBody(req);
            const email = String(body.email || '').trim().toLowerCase();
            const passwordHash = hashPassword(String(body.password || ''));
            const user = store.users.find((item) => item.email === email && item.passwordHash === passwordHash);
            if (!user) return sendJson(res, 401, { error: 'بيانات الدخول غير صحيحة.' });
            const token = crypto.randomBytes(24).toString('hex');
            store.sessions[token] = user.id;
            writeStore(store);
            const myArtworks = store.artworks.filter((art) => art.userId === user.id);
            sendJson(res, 200, { token, user: sanitizeUser(user), myArtworks });
            return;
        }

        if (req.method === 'GET' && apiPath === '/me') {
            if (!currentUser) return sendJson(res, 401, { error: 'غير مسجل الدخول.' });
            const myArtworks = store.artworks.filter((art) => art.userId === currentUser.id).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
            writeStore(store);
            sendJson(res, 200, { user: sanitizeUser(currentUser), myArtworks });
            return;
        }

        if (req.method === 'POST' && apiPath === '/artworks') {
            if (!currentUser) return sendJson(res, 401, { error: 'سجّل الدخول لحفظ العمل.' });
            const body = await parseBody(req);
            if (!body.imageData || !body.analysis || !body.analysis.scores) return sendJson(res, 400, { error: 'بيانات العمل غير مكتملة.' });
            const score = Number(body.analysis.scores.finalScore || 0);
            const artwork = {
                id: crypto.randomUUID(),
                userId: currentUser.id,
                title: String(body.title || 'عمل فني جديد').trim(),
                imageData: body.imageData,
                analysis: body.analysis,
                score,
                level: artworkLevel(score),
                createdAt: new Date().toISOString()
            };
            store.artworks.push(artwork);
            currentUser.points += Math.max(8, Math.round(score / 5));
            currentUser.rank = rankLabel(currentUser.points);
            writeStore(store);
            sendJson(res, 201, { artwork });
            return;
        }

        if (req.method === 'POST' && apiPath === '/comments') {
            if (!currentUser) return sendJson(res, 401, { error: 'سجّل الدخول لإضافة تعليق.' });
            const body = await parseBody(req);
            const artwork = store.artworks.find((art) => art.id === body.artworkId);
            if (!artwork) return sendJson(res, 404, { error: 'العمل غير موجود.' });
            const text = String(body.text || '').trim();
            const kind = body.kind === 'edit' ? 'edit' : 'comment';
            if (!text) return sendJson(res, 400, { error: 'التعليق فارغ.' });
            const pointsAwarded = critiqueReward(Number(body.score || artwork.score || 70), kind);
            const comment = { id: crypto.randomUUID(), artworkId: artwork.id, userId: currentUser.id, text, kind, pointsAwarded, createdAt: new Date().toISOString() };
            store.comments.push(comment);
            currentUser.points += pointsAwarded;
            currentUser.rank = rankLabel(currentUser.points);
            writeStore(store);
            sendJson(res, 201, { comment });
            return;
        }

        if (req.method === 'POST' && apiPath === '/reactions') {
            if (!currentUser) return sendJson(res, 401, { error: 'سجّل الدخول لإضافة تفاعل.' });
            const body = await parseBody(req);
            const artwork = store.artworks.find((art) => art.id === body.artworkId);
            if (!artwork) return sendJson(res, 404, { error: 'العمل غير موجود.' });
            const allowed = ['understood', 'deep', 'creative', 'unclear'];
            if (!allowed.includes(body.type)) return sendJson(res, 400, { error: 'نوع التفاعل غير صالح.' });
            store.reactions = store.reactions.filter((item) => !(item.artworkId === artwork.id && item.userId === currentUser.id));
            store.reactions.push({ id: crypto.randomUUID(), artworkId: artwork.id, userId: currentUser.id, type: body.type, createdAt: new Date().toISOString() });
            writeStore(store);
            sendJson(res, 201, { ok: true });
            return;
        }

        if (req.method === 'POST' && apiPath === '/critique-votes') {
            if (!currentUser) return sendJson(res, 401, { error: 'سجّل الدخول للتصويت على النقد.' });
            const body = await parseBody(req);
            const artwork = store.artworks.find((art) => art.id === body.artworkId);
            if (!artwork) return sendJson(res, 404, { error: 'العمل غير موجود.' });
            const allowed = ['agree', 'partial', 'disagree'];
            if (!allowed.includes(body.vote)) return sendJson(res, 400, { error: 'نوع التصويت غير صالح.' });
            store.critiqueVotes = store.critiqueVotes.filter((item) => !(item.artworkId === artwork.id && item.userId === currentUser.id));
            store.critiqueVotes.push({ id: crypto.randomUUID(), artworkId: artwork.id, userId: currentUser.id, vote: body.vote, createdAt: new Date().toISOString() });
            writeStore(store);
            sendJson(res, 201, { ok: true });
            return;
        }

        if (req.method === 'POST' && apiPath === '/follows') {
            if (!currentUser) return sendJson(res, 401, { error: 'سجّل الدخول للمتابعة.' });
            const body = await parseBody(req);
            const target = store.users.find((user) => user.id === body.targetUserId);
            if (!target) return sendJson(res, 404, { error: 'المستخدم غير موجود.' });
            if (target.id === currentUser.id) return sendJson(res, 400, { error: 'لا يمكنك متابعة نفسك.' });
            const existing = store.follows.find((item) => item.followerId === currentUser.id && item.targetUserId === target.id);
            if (existing) {
                store.follows = store.follows.filter((item) => item !== existing);
                writeStore(store);
                sendJson(res, 200, { following: false });
                return;
            }
            store.follows.push({ id: crypto.randomUUID(), followerId: currentUser.id, targetUserId: target.id, createdAt: new Date().toISOString() });
            writeStore(store);
            sendJson(res, 201, { following: true });
            return;
        }

        if ((req.method === 'DELETE' || req.method === 'PATCH') && apiPath.startsWith('/comments/')) {
            if (!currentUser) return sendJson(res, 401, { error: 'سجّل الدخول أولًا.' });
            const commentId = apiPath.split('/').pop();
            const comment = store.comments.find((item) => item.id === commentId);
            if (!comment) return sendJson(res, 404, { error: 'الرد غير موجود.' });
            if (currentUser.role !== 'admin' && comment.userId !== currentUser.id) return sendJson(res, 403, { error: req.method === 'PATCH' ? 'ليس لديك صلاحية تعديل هذا الرد.' : 'ليس لديك صلاحية حذف هذا الرد.' });
            if (req.method === 'DELETE') {
                store.comments = store.comments.filter((item) => item.id !== commentId);
                writeStore(store);
                sendJson(res, 200, { ok: true });
                return;
            }
            const body = await parseBody(req);
            const text = String(body.text || '').trim();
            if (!text) return sendJson(res, 400, { error: 'النص الجديد فارغ.' });
            comment.text = text;
            comment.updatedAt = new Date().toISOString();
            writeStore(store);
            sendJson(res, 200, { comment });
            return;
        }

        if (req.method === 'GET' && apiPath === '/admin/overview') {
            if (!currentUser || currentUser.role !== 'admin') return sendJson(res, 403, { error: 'صلاحية الأدمن مطلوبة.' });
            const users = store.users.slice().sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).map(sanitizeUser);
            const comments = store.comments.slice().sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).slice(0, 30).map((comment) => {
                const user = store.users.find((item) => item.id === comment.userId);
                const artwork = store.artworks.find((item) => item.id === comment.artworkId);
                return { ...comment, userName: user ? user.name : 'محذوف', artworkTitle: artwork ? artwork.title : 'عمل محذوف' };
            });
            sendJson(res, 200, { stats: { users: store.users.length, artworks: store.artworks.length, comments: store.comments.length }, users, comments });
            return;
        }

        if (req.method === 'GET' && apiPath.startsWith('/profile/')) {
            const userId = apiPath.split('/').pop();
            const target = store.users.find((user) => user.id === userId);
            if (!target) return sendJson(res, 404, { error: 'الفنان غير موجود.' });
            const artworks = buildArtworksResponse(store).filter((art) => art.owner.id === userId);
            const followersCount = store.follows.filter((item) => item.targetUserId === userId).length;
            const isFollowing = currentUser ? store.follows.some((item) => item.followerId === currentUser.id && item.targetUserId === userId) : false;
            sendJson(res, 200, { user: sanitizeUser(target), artworks, followersCount, isFollowing });
            return;
        }

        if (req.method === 'PATCH' && /\/users\/[^/]+\/points$/.test(apiPath)) {
            if (!currentUser || currentUser.role !== 'admin') return sendJson(res, 403, { error: 'صلاحية الأدمن مطلوبة.' });
            const userId = apiPath.split('/')[2];
            const body = await parseBody(req);
            const target = store.users.find((user) => user.id === userId);
            if (!target) return sendJson(res, 404, { error: 'المستخدم غير موجود.' });
            target.points += Number(body.amount || 0);
            target.rank = rankLabel(target.points);
            writeStore(store);
            sendJson(res, 200, { user: sanitizeUser(target) });
            return;
        }

        if (req.method === 'DELETE' && /\/users\/[^/]+$/.test(apiPath)) {
            if (!currentUser || currentUser.role !== 'admin') return sendJson(res, 403, { error: 'صلاحية الأدمن مطلوبة.' });
            const userId = apiPath.split('/').pop();
            const target = store.users.find((user) => user.id === userId);
            if (!target || target.role === 'admin') return sendJson(res, 404, { error: 'لا يمكن حذف هذا المستخدم.' });
            store.users = store.users.filter((user) => user.id !== userId);
            store.artworks = store.artworks.filter((art) => art.userId !== userId);
            store.comments = store.comments.filter((comment) => comment.userId !== userId);
            Object.keys(store.sessions).forEach((token) => {
                if (store.sessions[token] === userId) delete store.sessions[token];
            });
            writeStore(store);
            sendJson(res, 200, { ok: true });
            return;
        }

        sendJson(res, 404, { error: 'المسار غير موجود.' });
    } catch (error) {
        console.error(error);
        sendJson(res, 500, { error: 'حدث خطأ داخلي في السيرفر.' });
    }
};
