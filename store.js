const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = __dirname;
const DATA_DIR = process.env.VERCEL ? path.join('/tmp', 'artexpert-data') : path.join(ROOT, 'data');
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
                    rank: rankLabel(500),
                    createdAt: new Date().toISOString()
                }
            ],
            sessions: {},
            artworks: [],
            comments: [],
            follows: [],
            reactions: [],
            critiqueVotes: []
        };
        fs.writeFileSync(STORE_PATH, JSON.stringify(initial, null, 2), 'utf8');
    } else {
        const store = JSON.parse(fs.readFileSync(STORE_PATH, 'utf8'));
        const admin = store.users.find((user) => user.role === 'admin' || user.email === ADMIN_EMAIL);
        if (admin) {
            admin.name = ADMIN_NAME;
            admin.email = ADMIN_EMAIL;
            admin.passwordHash = hashPassword(ADMIN_PASSWORD);
            admin.role = 'admin';
        }
        if (!Array.isArray(store.follows)) store.follows = [];
        if (!Array.isArray(store.reactions)) store.reactions = [];
        if (!Array.isArray(store.critiqueVotes)) store.critiqueVotes = [];
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

function applyRanks(store) {
    store.users = store.users.map((user) => ({ ...user, rank: rankLabel(user.points || 0) }));
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

function getToken(req) {
    const auth = req.headers.authorization || '';
    return auth.startsWith('Bearer ') ? auth.slice(7) : '';
}

function getUserFromToken(store, req) {
    const token = getToken(req);
    if (!token) return null;
    const userId = store.sessions[token];
    if (!userId) return null;
    return store.users.find((user) => user.id === userId) || null;
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
            const reactions = store.reactions.filter((item) => item.artworkId === art.id);
            const critiqueVotes = store.critiqueVotes.filter((item) => item.artworkId === art.id);
            const reactionStats = {
                understood: reactions.filter((item) => item.type === 'understood').length,
                deep: reactions.filter((item) => item.type === 'deep').length,
                creative: reactions.filter((item) => item.type === 'creative').length,
                unclear: reactions.filter((item) => item.type === 'unclear').length
            };
            const critiqueVoteStats = {
                agree: critiqueVotes.filter((item) => item.vote === 'agree').length,
                partial: critiqueVotes.filter((item) => item.vote === 'partial').length,
                disagree: critiqueVotes.filter((item) => item.vote === 'disagree').length
            };
            return {
                ...art,
                owner: sanitizeUser(owner),
                comments,
                reactionStats,
                critiqueVoteStats
            };
        });
}

module.exports = {
    ADMIN_EMAIL,
    ADMIN_PASSWORD,
    ADMIN_NAME,
    applyRanks,
    artworkLevel,
    buildArtworksResponse,
    critiqueReward,
    ensureStore,
    getToken,
    getUserFromToken,
    hashPassword,
    isQuadName,
    isStrongPassword,
    rankLabel,
    readStore,
    sanitizeUser,
    writeStore
};
