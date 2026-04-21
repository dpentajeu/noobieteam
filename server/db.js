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
  avatarUrl: String,
  method: { type: String, default: 'local' },
  vaultPin: { type: String }, // Hashed PIN for Google OAuth vault decryption
  lastLogin: { type: Date }
}, { timestamps: true });

const workspaceSchema = new mongoose.Schema({
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
    value: String,
    iv: String,
    authTag: String
  }]
}, { timestamps: true });

const taskSchema = new mongoose.Schema({
  workspaceId: { type: String, required: true },
  columnId: String,
  title: { type: String, required: true },
  archived: { type: Boolean, default: false },
  content: String,
  urgency: { type: String, enum: ['LOW', 'MED', 'HIGH'], default: 'LOW' },
  dueDate: Date,
  expiredAlertAcknowledged: { type: Boolean, default: false },
  order: Number,
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
    dataUrl: String,
    size: String
  }]
}, { timestamps: true });

userSchema.set('toJSON', { virtuals: true });
workspaceSchema.set('toJSON', { virtuals: true });
taskSchema.set('toJSON', { virtuals: true });


const docSchema = new mongoose.Schema({
  workspaceId: { type: String, required: true },
  title: { type: String, required: true },
  type: { type: String, enum: ['TEXT', 'API'], default: 'TEXT' },
  content: String,
  parentId: String,
  order: Number,
  apiSpec: {
    method: { type: String, enum: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'], default: 'GET' },
    url: String,
    headers: [{ key: String, value: String }],
    queryParams: [{ key: String, value: String }],
    body: String,
    examples: [{ name: String, requestBody: String, responseBody: String, status: Number }]
  },
  createdBy: String
}, { timestamps: true });
docSchema.set('toJSON', { virtuals: true });
const Doc = mongoose.model('Doc', docSchema);

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


const emojiEventSchema = new mongoose.Schema({
  workspaceId: { type: String, required: true },
  senderEmail: { type: String, required: true },
  emojiType: { type: String, required: true },
  viewedBy: [{ type: String }] // Array of user emails who have seen this
}, { timestamps: true });
emojiEventSchema.set('toJSON', { virtuals: true });
const EmojiEvent = mongoose.model('EmojiEvent', emojiEventSchema);

module.exports = { connectDB, User, Workspace, Task, Doc, Env, EmojiEvent };
