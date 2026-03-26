const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { URL } = require('url');

const PORT = process.env.PORT || 3000;
const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, 'data');
const STORE_PATH = path.join(DATA_DIR, 'store.json');
const ADMIN_EMAIL = 'admin@artexpert.local';
const ADMIN_PASSWORD = 'ArtExpert#Admin2026!';
const ADMIN_NAME = 'Art Expert Vision Admin';

function hashPassword(password) {
    return crypto.createHash('sha256').update(password).digest('hex');
}

function isStrongPassword(password) {
    return password.length >= 10 &&
        /[A-Z]/.test(password) &&
        /[a-z]/.test(password) &&
        /\d/.test(password) &&
        /[^A-Za-z0-9]/.test(password);
}

function isQuadName(name) {
    return name.trim().split(/\s+/).filter(Boolean).length >= 4;
}

function ensureStore() {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    if (!fs.existsSync(STORE_PATH)) {
        const adminId = crypto.randomUUID();
        const initial = {
            users: [
                {
                    id: adminId,
                    name: ADMIN_NAME,
                    email: ADMIN_EMAIL,
                    passwordHash: hashPassword(ADMIN_PASSWORD),
                    role: 'admin',
                    points: 500,
                    rank: 'أسطورة النقد',
                    createdAt: new Date().toISOString()
                }
            ],
            sessions: {},
            artworks: [],
            comments: []
        };
        fs.writeFileSync(STORE_PATH, JSON.stringify(initial, null, 2), 'utf8');
    } else {
        const store = JSON.parse(fs.readFileSync(STORE_PATH, 'utf8'));
        const admin = store.users.find((user) => user.role === 'admin' || user.email === ADMIN_EMAIL);
        if (admin) {
            admin.name = ADMIN_NAME;
            admin.email = ADMIN_EMAIL;
            admin.passwordHash = hashPassword(ADMIN_PASSWORD);
        }
        fs.writeFileSync(STORE_PATH, JSON.stringify(store, null, 2), 'utf8');
    }
}

function readStore() {
    ensureStore();
    return JSON.parse(fs.readFileSync(STORE_PATH, 'utf8'));
}

function writeStore(store) {
    fs.writeFileSync(STORE_PATH, JSON.stringify(store, null, 2), 'utf8');
}

function rankLabel(points) {
    if (points >= 320) return 'أسطورة النقد';
    if (points >= 220) return 'ناقد ذهبي';
    if (points >= 140) return 'ناقد محترف';
    if (points >= 70) return 'عين فنية';
    if (points >= 30) return 'متذوق متقدم';
    return 'مبدع صاعد';
}

function artworkLevel(score) {
    if (score >= 98) return 'ماستر بيس';
    if (score >= 92) return 'نخبة المعرض';
    if (score >= 85) return 'قوي جدًا';
    if (score >= 75) return 'واعد';
    return 'قيد التطوير';
}

function critiqueReward(score, kind) {
    const base = kind === 'edit' ? 10 : 6;
    return base + Math.max(0, Math.floor((score - 70) / 8));
}

function applyRanks(store) {
    store.users = store.users.map((user) => ({ ...user, rank: rankLabel(user.points || 0) }));
}

function sendJson(res, statusCode, payload) {
    res.writeHead(statusCode, {
        'Content-Type': 'application/json; charset=utf-8',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS'
    });
    res.end(JSON.stringify(payload));
}

function sendFile(res, filePath) {
    const ext = path.extname(filePath).toLowerCase();
    const types = {
        '.html': 'text/html; charset=utf-8',
        '.js': 'text/javascript; charset=utf-8',
        '.css': 'text/css; charset=utf-8',
        '.json': 'application/json; charset=utf-8'
    };
    const contentType = types[ext] || 'application/octet-stream';
    fs.readFile(filePath, (error, content) => {
        if (error) {
            sendJson(res, 404, { error: 'الملف غير موجود' });
            return;
        }
        res.writeHead(200, { 'Content-Type': contentType });
        res.end(content);
    });
}

function parseBody(req) {
    return new Promise((resolve, reject) => {
        let body = '';
        req.on('data', (chunk) => { body += chunk; });
        req.on('end', () => {
            if (!body) {
                resolve({});
                return;
            }
            try {
                resolve(JSON.parse(body));
            } catch (error) {
                reject(new Error('تعذر قراءة البيانات المرسلة'));
            }
        });
        req.on('error', reject);
    });
}

function getToken(req) {
    const auth = req.headers.authorization || '';
    if (auth.startsWith('Bearer ')) return auth.slice(7);
    return '';
}

function getUserFromToken(store, req) {
    const token = getToken(req);
    if (!token) return null;
    const userId = store.sessions[token];
    if (!userId) return null;
    return store.users.find((user) => user.id === userId) || null;
}

function sanitizeUser(user) {
    return {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        points: user.points,
        rank: user.rank,
        createdAt: user.createdAt
    };
}

function buildArtworksResponse(store) {
    applyRanks(store);
    return store.artworks
        .slice()
        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
        .map((art) => {
            const owner = store.users.find((user) => user.id === art.userId);
            const comments = store.comments
                .filter((comment) => comment.artworkId === art.id)
                .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
                .map((comment) => {
                    const user = store.users.find((u) => u.id === comment.userId);
                    return {
                        ...comment,
                        user: sanitizeUser(user || { id: '', name: 'محذوف', email: '', role: 'user', points: 0, rank: 'مجهول', createdAt: new Date().toISOString() })
                    };
                });
            return {
                ...art,
                owner: sanitizeUser(owner),
                comments
            };
        });
}

async function handleApi(req, res, url) {
    const store = readStore();
    applyRanks(store);
    const currentUser = getUserFromToken(store, req);

    if (req.method === 'GET' && url.pathname === '/api/gallery') {
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

    if (req.method === 'POST' && url.pathname === '/api/register') {
        const body = await parseBody(req);
        const name = String(body.name || '').trim();
        const email = String(body.email || '').trim().toLowerCase();
        const password = String(body.password || '');
        if (!name || !email || !email.includes('@')) {
            sendJson(res, 400, { error: 'الاسم الكامل والبريد الإلكتروني الصحيح مطلوبان.' });
            return;
        }
        if (!isQuadName(name)) {
            sendJson(res, 400, { error: 'الاسم الرباعي مطلوب ليظهر كاملًا في الشهادة.' });
            return;
        }
        if (!isStrongPassword(password)) {
            sendJson(res, 400, { error: 'كلمة المرور يجب أن تكون قوية: 10 أحرف على الأقل وتشمل حرفًا كبيرًا وصغيرًا ورقمًا ورمزًا.' });
            return;
        }
        if (store.users.some((user) => user.email === email)) {
            sendJson(res, 400, { error: 'هذا الإيميل مستخدم بالفعل.' });
            return;
        }
        const user = {
            id: crypto.randomUUID(),
            name,
            email,
            passwordHash: hashPassword(password),
            role: 'user',
            points: 0,
            rank: rankLabel(0),
            createdAt: new Date().toISOString()
        };
        store.users.push(user);
        const token = crypto.randomBytes(24).toString('hex');
        store.sessions[token] = user.id;
        writeStore(store);
        sendJson(res, 201, { token, user: sanitizeUser(user) });
        return;
    }

    if (req.method === 'POST' && url.pathname === '/api/login') {
        const body = await parseBody(req);
        const email = String(body.email || '').trim().toLowerCase();
        const passwordHash = hashPassword(String(body.password || ''));
        const user = store.users.find((item) => item.email === email && item.passwordHash === passwordHash);
        if (!user) {
            sendJson(res, 401, { error: 'بيانات الدخول غير صحيحة.' });
            return;
        }
        const token = crypto.randomBytes(24).toString('hex');
        store.sessions[token] = user.id;
        writeStore(store);
        const myArtworks = store.artworks.filter((art) => art.userId === user.id);
        sendJson(res, 200, { token, user: sanitizeUser(user), myArtworks });
        return;
    }

    if (req.method === 'GET' && url.pathname === '/api/me') {
        if (!currentUser) {
            sendJson(res, 401, { error: 'غير مسجل الدخول.' });
            return;
        }
        const myArtworks = store.artworks
            .filter((art) => art.userId === currentUser.id)
            .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
        writeStore(store);
        sendJson(res, 200, { user: sanitizeUser(currentUser), myArtworks });
        return;
    }

    if (req.method === 'POST' && url.pathname === '/api/artworks') {
        if (!currentUser) {
            sendJson(res, 401, { error: 'سجّل الدخول لحفظ العمل.' });
            return;
        }
        const body = await parseBody(req);
        if (!body.imageData || !body.analysis || !body.analysis.scores) {
            sendJson(res, 400, { error: 'بيانات العمل غير مكتملة.' });
            return;
        }
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

    if (req.method === 'POST' && url.pathname === '/api/comments') {
        if (!currentUser) {
            sendJson(res, 401, { error: 'سجّل الدخول لإضافة تعليق.' });
            return;
        }
        const body = await parseBody(req);
        const artwork = store.artworks.find((art) => art.id === body.artworkId);
        if (!artwork) {
            sendJson(res, 404, { error: 'العمل غير موجود.' });
            return;
        }
        const text = String(body.text || '').trim();
        const kind = body.kind === 'edit' ? 'edit' : 'comment';
        if (!text) {
            sendJson(res, 400, { error: 'التعليق فارغ.' });
            return;
        }
        const pointsAwarded = critiqueReward(Number(body.score || artwork.score || 70), kind);
        const comment = {
            id: crypto.randomUUID(),
            artworkId: artwork.id,
            userId: currentUser.id,
            text,
            kind,
            pointsAwarded,
            createdAt: new Date().toISOString()
        };
        store.comments.push(comment);
        currentUser.points += pointsAwarded;
        currentUser.rank = rankLabel(currentUser.points);
        writeStore(store);
        sendJson(res, 201, { comment });
        return;
    }

    if (req.method === 'DELETE' && url.pathname.startsWith('/api/comments/')) {
        if (!currentUser) {
            sendJson(res, 401, { error: 'سجّل الدخول أولًا.' });
            return;
        }
        const commentId = url.pathname.split('/').pop();
        const index = store.comments.findIndex((comment) => comment.id === commentId);
        if (index === -1) {
            sendJson(res, 404, { error: 'الرد غير موجود.' });
            return;
        }
        const comment = store.comments[index];
        if (currentUser.role !== 'admin' && comment.userId !== currentUser.id) {
            sendJson(res, 403, { error: 'ليس لديك صلاحية حذف هذا الرد.' });
            return;
        }
        store.comments.splice(index, 1);
        writeStore(store);
        sendJson(res, 200, { ok: true });
        return;
    }

    if (req.method === 'PATCH' && url.pathname.startsWith('/api/comments/')) {
        if (!currentUser) {
            sendJson(res, 401, { error: 'سجّل الدخول أولًا.' });
            return;
        }
        const commentId = url.pathname.split('/').pop();
        const comment = store.comments.find((item) => item.id === commentId);
        if (!comment) {
            sendJson(res, 404, { error: 'الرد غير موجود.' });
            return;
        }
        if (currentUser.role !== 'admin' && comment.userId !== currentUser.id) {
            sendJson(res, 403, { error: 'ليس لديك صلاحية تعديل هذا الرد.' });
            return;
        }
        const body = await parseBody(req);
        const text = String(body.text || '').trim();
        if (!text) {
            sendJson(res, 400, { error: 'النص الجديد فارغ.' });
            return;
        }
        comment.text = text;
        comment.updatedAt = new Date().toISOString();
        writeStore(store);
        sendJson(res, 200, { comment });
        return;
    }

    if (req.method === 'GET' && url.pathname === '/api/admin/overview') {
        if (!currentUser || currentUser.role !== 'admin') {
            sendJson(res, 403, { error: 'صلاحية الأدمن مطلوبة.' });
            return;
        }
        const users = store.users
            .slice()
            .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
            .map(sanitizeUser);
        const comments = store.comments
            .slice()
            .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
            .slice(0, 30)
            .map((comment) => {
                const user = store.users.find((item) => item.id === comment.userId);
                const artwork = store.artworks.find((item) => item.id === comment.artworkId);
                return {
                    ...comment,
                    userName: user ? user.name : 'محذوف',
                    artworkTitle: artwork ? artwork.title : 'عمل محذوف'
                };
            });
        sendJson(res, 200, {
            stats: {
                users: store.users.length,
                artworks: store.artworks.length,
                comments: store.comments.length
            },
            users,
            comments
        });
        return;
    }

    if (req.method === 'PATCH' && /\/api\/users\/[^/]+\/points$/.test(url.pathname)) {
        if (!currentUser || currentUser.role !== 'admin') {
            sendJson(res, 403, { error: 'صلاحية الأدمن مطلوبة.' });
            return;
        }
        const userId = url.pathname.split('/')[3];
        const body = await parseBody(req);
        const target = store.users.find((user) => user.id === userId);
        if (!target) {
            sendJson(res, 404, { error: 'المستخدم غير موجود.' });
            return;
        }
        target.points += Number(body.amount || 0);
        target.rank = rankLabel(target.points);
        writeStore(store);
        sendJson(res, 200, { user: sanitizeUser(target) });
        return;
    }

    if (req.method === 'DELETE' && /\/api\/users\/[^/]+$/.test(url.pathname)) {
        if (!currentUser || currentUser.role !== 'admin') {
            sendJson(res, 403, { error: 'صلاحية الأدمن مطلوبة.' });
            return;
        }
        const userId = url.pathname.split('/').pop();
        const target = store.users.find((user) => user.id === userId);
        if (!target || target.role === 'admin') {
            sendJson(res, 404, { error: 'لا يمكن حذف هذا المستخدم.' });
            return;
        }
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
}

const server = http.createServer(async (req, res) => {
    try {
        const url = new URL(req.url, `http://${req.headers.host}`);

        if (req.method === 'OPTIONS') {
            sendJson(res, 200, { ok: true });
            return;
        }

        if (url.pathname.startsWith('/api/')) {
            await handleApi(req, res, url);
            return;
        }

        if (url.pathname === '/' || url.pathname === '/index.html') {
            sendFile(res, path.join(ROOT, 'index.html'));
            return;
        }

        const filePath = path.join(ROOT, url.pathname.replace(/^\/+/, ''));
        if (filePath.startsWith(ROOT) && fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
            sendFile(res, filePath);
            return;
        }

        sendJson(res, 404, { error: 'الصفحة غير موجودة.' });
    } catch (error) {
        console.error(error);
        sendJson(res, 500, { error: 'حدث خطأ داخلي في السيرفر.' });
    }
});

ensureStore();
server.listen(PORT, () => {
    console.log(`ArtExpert Vision server running on http://localhost:${PORT}`);
});
