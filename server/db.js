const crypto = require('crypto');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

let mongoServer;

const connectDB = async () => {
  try {
    if (process.env.MOCK_DB === 'true') {
        console.log('MongoDB connection bypassed (MOCK_DB=true)');
        return;
    }
    
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/noobieteam', {
      serverSelectionTimeoutMS: 2000,
    });
    console.log('MongoDB connected');
  } catch (err) {
    console.warn('MongoDB connection error on localhost. Booting In-Memory MongoDB Fallback for Tester...');
    try {
        mongoServer = await MongoMemoryServer.create({
            instance: {
                dbPath: '/root/workspace/mas-projects/noobieteam/mongodb_data',
                storageEngine: 'wiredTiger',
            }
        });
        const uri = mongoServer.getUri();
        await mongoose.connect(uri);
        console.log(`In-Memory MongoDB (Persistent) connected at ${uri}`);
    } catch (memErr) {
        console.error('In-Memory MongoDB failed to start:', memErr);
    }
  }
};

const userSchema = new mongoose.Schema({
  email: { type: String, required: true, unique: true },
  password: { type: String }, // Optional for Google OAuth users
  name: String,
  avatar: String,
  avatarUrl: String,
  homeBackgroundImage: String,
  method: { type: String, default: 'local' },
  vaultPin: { type: String }, // Hashed PIN for Google OAuth vault decryption
  lastLogin: { type: Date },
  // Global system role. Per-workspace role lives in workspaceSchema.members[].role (OWNER/MEMBER).
  systemRole: { type: String, enum: ['SUPERADMIN', 'USER'], default: 'USER' },
  banned: { type: Boolean, default: false } // Set by a superadmin; blocks login and all API access.
}, { timestamps: true });

const workspaceSchema = new mongoose.Schema({
  slug: { type: String, sparse: true, unique: true },
  name: { type: String, required: true },
  color: String,
  avatar: String,
  archived: { type: Boolean, default: false },
  members: [{
    userId: { type: String },
    role: { type: String, enum: ['OWNER', 'MEMBER'], default: 'MEMBER' },
    joinedAt: { type: Date, default: Date.now }
  }],
  columns: [{
    id: String,
    title: String,
    order: Number
  }],
  secrets: [{
    id: String,
    service: String,
    url: String,
    value: String,
    iv: String,
    authTag: String
  }]
}, { timestamps: true });

const taskSchema = new mongoose.Schema({
  workspaceId: { type: String, required: true },
  columnId: String,
  epic: { type: String },
  title: { type: String, required: true },
  archived: { type: Boolean, default: false },
  content: String,
  urgency: { type: String, enum: ['LOW', 'MED', 'HIGH'], default: 'LOW' },
  qaStatus: { type: String, enum: ['NONE', 'PENDING', 'PASSED', 'FAILED'], default: 'NONE' },
  dueDate: Date,
  expiredAlertAcknowledged: { type: Boolean, default: false },
  order: Number,
  orderIndex: Number,
  assignees: [{ type: String }],
  checklist: [{
    id: String,
    text: String,
    done: { type: Boolean, default: false }
  }],
  auditTrail: [{ user: String, action: String, timestamp: { type: Date, default: Date.now } }],

  comments: [{
    id: { type: String, default: () => new mongoose.Types.ObjectId().toString() },
    authorEmail: { type: String, required: true },
    text: { type: String, required: true },
    timestamp: { type: Date, default: Date.now },
    taggedUsers: [{ type: String }] // Array of user emails
  }],
  attachments: [{
    id: String,
    name: String,
    // Storage key under <repo>/uploads/, e.g. "task_media/1753...-ab12.png".
    path: String,
    mimeType: String,
    byteSize: Number,
    size: String, // human-readable, e.g. "412.3 KB"
    // Legacy: files used to be base64-embedded here instead of uploaded. Kept so
    // attachments created before the switch still render. New uploads set `path`.
    dataUrl: String
  }]
}, { timestamps: true, optimisticConcurrency: true });

userSchema.set('toJSON', {
  virtuals: true,
  transform: (_doc, ret) => {
    if (!ret.avatar && ret.avatarUrl) ret.avatar = ret.avatarUrl;
    delete ret.password;
    return ret;
  }
});
workspaceSchema.set('toJSON', { virtuals: true });
taskSchema.set('toJSON', { virtuals: true });


const docSchema = new mongoose.Schema({
  workspaceId: { type: String, required: true },
  title: { type: String, required: true },
  type: { type: String, enum: ['TEXT', 'API'], default: 'TEXT' },
  content: String,
  parentId: String,
  folderId: String, // Reference to Folder
  order: Number,
  apiSpec: {
    method: { type: String, enum: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'], default: 'GET' },
    url: String,
    headers: [{ key: String, value: String }],
    queryParams: [{ key: String, value: String }],
    body: String,
    // Auth helper selection. The generated Authorization header / API-key pair is
    // derived from this at request time rather than stored, so switching type
    // never leaves a stale header behind.
    auth: {
      type: { type: String, enum: ['none', 'bearer', 'basic', 'apikey'], default: 'none' },
      token: String,
      username: String,
      password: String,
      key: String,
      value: String,
      addTo: { type: String, enum: ['header', 'query'], default: 'header' }
    },
    // Declarative response checks, stored as data and evaluated by the client.
    // Deliberately not user-supplied JavaScript: collections are shared between
    // workspace members and published publicly, so anything executable here
    // would run in a stranger's browser on our own origin.
    assertions: [{
      source: { type: String, enum: ['status', 'statusText', 'time', 'size', 'header', 'body', 'rawBody'], default: 'status' },
      path: String,   // header name, or a dot/bracket path into the JSON body
      op: { type: String, enum: ['eq', 'ne', 'lt', 'gt', 'contains', 'notContains', 'exists', 'notExists'], default: 'eq' },
      value: String
    }],
    // Pull values out of a response and into environment variables, so one
    // request can feed the next — the login-then-use-the-token flow that is
    // otherwise the most common reason to reach for a script.
    extract: [{
      from: { type: String, enum: ['body', 'header', 'rawBody'], default: 'body' },
      path: String,
      into: String    // environment variable name
    }],
    examples: [{ name: String, requestBody: String, responseBody: String, status: Number }]
  },
  passwordProtected: { type: Boolean, default: false },
  passwordHash: { type: String, select: false }, // SHA-256 of share password; never exposed to clients
  createdBy: String
}, { timestamps: true });
docSchema.set('toJSON', {
  virtuals: true,
  transform: (_doc, ret) => { delete ret.passwordHash; return ret; }
});
const Doc = mongoose.model('Doc', docSchema);

const folderSchema = new mongoose.Schema({
  workspaceId: { type: String, required: true },
  name: { type: String, required: true },
  slug: { type: String }, // For dynamic URL e.g. folder name in url
  // Which surface this folder belongs to: the GitBook-style Docs page or the
  // Postman-style API page. Deliberately on the folder rather than derived from
  // `Doc.type` — a collection is a single published thing with one URL
  // (/docs/:ws/:slug or /apis/:ws/:slug), so membership cannot depend on what
  // happens to be inside it at the moment. Subfolders inherit their root's kind.
  kind: { type: String, enum: ['DOCS', 'API'], default: 'DOCS' },
  // Whether the collection is served on its public URL at all. Publishing is an
  // explicit act: an API collection holds request headers, bodies and recorded
  // examples that routinely carry credentials, and its public URL is derived
  // from names anyone could guess (/apis/<workspace>/<folder-slug>). Defaults to
  // false so nothing becomes readable by simply existing. Enforced for API
  // collections in routes/public.js; DOCS folders are not gated yet, so their
  // existing share links keep working.
  published: { type: Boolean, default: false },
  order: Number,
  createdBy: String,
  description: String,
  parentId: String,
  environments: [{
    id: String,
    name: String,
    baseUrl: String,
    // Named `{{variables}}` substituted into an endpoint's URL, headers, params
    // and body. `baseUrl` stays separate because it also joins relative URLs.
    variables: [{ key: String, value: String }]
  }]
}, { timestamps: true });
folderSchema.set('toJSON', { virtuals: true });
const Folder = mongoose.model('Folder', folderSchema);


const envSchema = new mongoose.Schema({
  workspaceId: { type: String, required: true },
  name: { type: String, required: true },
  variables: [{ key: String, value: String, isSecret: { type: Boolean, default: false } }]
}, { timestamps: true });
envSchema.set('toJSON', { virtuals: true });
const Env = mongoose.model('Env', envSchema);

const User = mongoose.model('User', userSchema);
const Workspace = mongoose.model('Workspace', workspaceSchema);
const Task = mongoose.model('Task', taskSchema);


const workspaceActivitySchema = new mongoose.Schema({
  workspaceId: { type: String, required: true },
  user: { type: String, required: true },
  action: { type: String, required: true },
  resourceType: { type: String, enum: ['card', 'stage', 'vault', 'doc', 'folder', 'api'], required: true },
  resourceName: { type: String },
}, { timestamps: true });
workspaceActivitySchema.set('toJSON', { virtuals: true });
const WorkspaceActivity = mongoose.model('WorkspaceActivity', workspaceActivitySchema);

const emojiEventSchema = new mongoose.Schema({
  workspaceId: { type: String, required: true },
  senderEmail: { type: String, required: true },
  emojiType: { type: String, required: true },
  viewedBy: [{ type: String }] // Array of user emails who have seen this
}, { timestamps: true });
emojiEventSchema.set('toJSON', { virtuals: true });
const EmojiEvent = mongoose.model('EmojiEvent', emojiEventSchema);

module.exports = { connectDB, User, Workspace, Task, Doc, Folder, Env, EmojiEvent, WorkspaceActivity };
