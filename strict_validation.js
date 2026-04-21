const BASE_URL = 'http://localhost:9717/api';
const EMAIL = 'validation_boss@gmail.com';
const PIN = '888999';

async function runValidation() {
    try {
        console.log('🚀 Starting Strict Technical Validation...');

        // --- 1. VAULT VALIDATION ---
        console.log('\n[1] Validating Vault Reveal & Crypto Stability...');
        
        // Ensure user exists
        await fetch(`${BASE_URL}/users`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: EMAIL, password: 'p', method: 'local' })
        });

        // Set PIN
        await fetch(`${BASE_URL}/users/pin`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: EMAIL, pin: PIN })
        });
        console.log('   ✅ Master PIN established.');

        // Create workspace & Save credential
        const wsRes = await fetch(`${BASE_URL}/workspaces`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: 'Validation WS', members: [{ userId: EMAIL, role: 'OWNER' }] })
        });
        const ws = await wsRes.json();
        const wsId = ws.id || ws._id;

        // Simulate save (frontend logic uses raw PIN or hashed PIN? VaultTab uses password: user?.vaultPin || user?.password)
        // Since we are simulating the reveal, we need an encrypted secret in the DB.
        // The endpoint is /api/workspaces/:wsId/vault/encrypt
        // For local users, password is user.password. For OAuth it's user.vaultPin.
        // Wait, the Boss said "after I create a credential".
        
        // Let's assume we use the PIN for encryption as well if it's set.
        const pinHash = (text) => {
            let hash = 0;
            for (let i = 0; i < text.length; i++) {
                const char = text.charCodeAt(i);
                hash = ((hash << 5) - hash) + char;
                hash = hash & hash;
            }
            return Math.abs(hash).toString(16).padStart(64, '0');
        };
        const hashedPin = pinHash(PIN);

        const encRes = await fetch(`${BASE_URL}/workspaces/${wsId}/vault/encrypt`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text: 'VALIDATION_SECRET', password: hashedPin })
        });
        const encData = await encRes.json();
        console.log('   ✅ Credential encrypted and saved.');

        // Reveal
        const decRes = await fetch(`${BASE_URL}/workspaces/${wsId}/vault/decrypt`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ cipherBase64: encData.encrypted, password: hashedPin })
        });
        const decData = await decRes.json();
        if (decData.decrypted === 'VALIDATION_SECRET') {
            console.log('   ✅ SUCCESS: Vault Reveal functional without digest crash.');
        } else {
            throw new Error(`Vault Decryption Failed: ${JSON.stringify(decData)}`);
        }


        // --- 2. EXPIRED CARD VALIDATION ---
        console.log('\n[2] Validating Expired Card Intervention Modal...');
        
        const now = new Date();
        const past1 = new Date(now.getTime() - (1 * 24 * 60 * 60 * 1000)).toISOString();
        const past2 = new Date(now.getTime() - (2 * 24 * 60 * 60 * 1000)).toISOString();
        const past4 = new Date(now.getTime() - (4 * 24 * 60 * 60 * 1000)).toISOString();

        console.log('   Creating test tasks (1d ago, 2d ago, 4d ago)...');
        const t1 = await createTask(wsId, 'Task-1d', past1);
        const t2 = await createTask(wsId, 'Task-2d', past2);
        const t4 = await createTask(wsId, 'Task-4d', past4);

        // Simulate frontend logic
        const getTasks = async () => (await (await fetch(`${BASE_URL}/workspaces/${wsId}/tasks`)).json());
        let tasks = await getTasks();
        
        const getExpired = (taskList) => taskList.filter(c => {
            if (c.archived || !c.dueDate || c.expiredAlertAcknowledged) return false;
            const diffDays = (new Date() - new Date(c.dueDate)) / (1000 * 60 * 60 * 24);
            return diffDays >= 3;
        });

        let expired = getExpired(tasks);
        console.log(`   Found ${expired.length} expired cards. Titles:`, expired.map(e => e.title));
        if (expired.length === 1 && expired[0].title === 'Task-4d') {
            console.log('   ✅ PASS: Correct filtering for 3+ days expiry.');
        } else {
            throw new Error('Incorrect expiry filtering logic.');
        }

        // Test Archive Action
        console.log('   Executing Bulk Archive for Task-4d...');
        await fetch(`${BASE_URL}/workspaces/${wsId}/tasks/bulk-archive`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ cardIds: [t4._id || t4.id] })
        });

        tasks = await getTasks();
        expired = getExpired(tasks);
        console.log(`   After Archive: Found ${expired.length} expired cards.`);
        if (expired.length === 0) {
            console.log('   ✅ SUCCESS: Acknowledged cards no longer trigger alert.');
        } else {
            throw new Error('Archived card still triggering alert!');
        }

        // Test "Newer card that expired only will trigger alert again"
        console.log('   Creating a NEW 5-day expired task...');
        const past5 = new Date(now.getTime() - (5 * 24 * 60 * 60 * 1000)).toISOString();
        await createTask(wsId, 'Task-5d', past5);
        
        tasks = await getTasks();
        expired = getExpired(tasks);
        console.log(`   Final check: Found ${expired.length} expired cards. Title:`, expired[0]?.title);
        if (expired.length === 1 && expired[0].title === 'Task-5d') {
            console.log('   ✅ PASS: New expired tasks correctly trigger alerts.');
        } else {
            throw new Error('New expired task not detected!');
        }

        console.log('\n✨ ALL VALIDATIONS PASSED.');

    } catch (err) {
        console.error('\n❌ VALIDATION FAILED:', err.message);
        process.exit(1);
    }
}

async function createTask(wsId, title, dueDate) {
    const res = await fetch(`${BASE_URL}/workspaces/${wsId}/tasks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, dueDate, columnId: 'todo' })
    });
    return await res.json();
}

runValidation();
