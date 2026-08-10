const express = require('express');
const router = express.Router();
const wrap = require('../middleware/asyncHandler');
const { body } = require('express-validator');
const validate = require('../middleware/validate');

// Server-side AI config. The API key NEVER leaves the server.
const aiEnv = () => ({
    model: process.env.GEMINI_MODEL_ID || process.env.OPENAI_MODEL_ID || 'gemini-3-flash-preview',
    apiKey: process.env.GEMINI_API_KEY || process.env.OPENAI_API_KEY || '',
    baseUrl: process.env.GEMINI_BASE_URL || process.env.OPENAI_BASE_URL || 'https://generativelanguage.googleapis.com/v1beta/openai/',
});

// Proxy for AI chat/completions. The client sends { messages, tools } and gets
// back the normalized OpenAI-style { choices: [...] } shape — no key exposed.
router.post('/ai/generate', [
    body('messages').isArray({ min: 1 }).withMessage('messages array is required'),
    body('messages.*.role').isIn(['system', 'user', 'assistant', 'tool']).withMessage('Invalid message role'),
    body('tools').optional().isArray().withMessage('tools must be an array'),
], validate, wrap(async (req, res) => {
    const { messages, tools = [] } = req.body;

    const { model, apiKey, baseUrl } = aiEnv();
    if (!apiKey) return res.status(503).json({ error: 'AI is not configured on the server' });

    const sanitizedBaseUrl = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;

    // --- Gemini native ---
    if (sanitizedBaseUrl.includes('generativelanguage.googleapis.com')) {
        const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
        let systemInstruction = null;
        const contents = [];
        for (const m of messages) {
            if (m.role === 'system') {
                systemInstruction = { parts: [{ text: m.content }] };
            } else if (m.role === 'user') {
                contents.push({ role: 'user', parts: [{ text: m.content }] });
            } else if (m.role === 'assistant') {
                const parts = [];
                if (m.content) parts.push({ text: m.content });
                if (m.tool_calls) {
                    m.tool_calls.forEach(tc => {
                        const part = { functionCall: { name: tc.function.name, args: JSON.parse(tc.function.arguments) } };
                        if (tc.thought_signature) {
                            part.thoughtSignature = tc.thought_signature;
                            part.thought_signature = tc.thought_signature;
                        }
                        parts.push(part);
                    });
                }
                if (parts.length > 0) contents.push({ role: 'model', parts });
            } else if (m.role === 'tool') {
                contents.push({
                    role: 'function',
                    parts: [{ functionResponse: { name: m.name || 'tool', response: { result: m.content } } }],
                });
            }
        }

        const geminiTools = tools.length > 0
            ? [{ functionDeclarations: tools.map(t => ({ name: t.function.name, description: t.function.description, parameters: t.function.parameters })) }]
            : undefined;
        const payload = { contents };
        if (systemInstruction) payload.systemInstruction = systemInstruction;
        if (geminiTools) payload.tools = geminiTools;

        const response = await fetch(geminiUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
        if (!response.ok) return res.status(502).json({ error: `AI Service Error: ${await response.text()}` });
        const data = await response.json();

        const parts = data.candidates[0].content.parts;
        const toolCalls = parts.filter(p => p.functionCall).map((p, i) => ({
            id: p.functionCall.id || `call_${i}`,
            function: { name: p.functionCall.name, arguments: JSON.stringify(p.functionCall.args) },
            thought_signature: p.thoughtSignature || p.thought_signature || null,
        }));

        if (toolCalls.length > 0) return res.json({ choices: [{ message: { role: 'assistant', content: null, tool_calls: toolCalls } }] });
        return res.json({ choices: [{ message: { role: 'assistant', content: parts[0].text } }] });
    }

    // --- OpenAI-compatible ---
    const finalUrl = `${sanitizedBaseUrl}/chat/completions`;
    const headers = { 'Content-Type': 'application/json' };
    if (!finalUrl.includes('?key=')) headers['Authorization'] = `Bearer ${apiKey}`;

    const response = await fetch(finalUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify({ model, messages, tools: tools.length > 0 ? tools : undefined }),
    });
    if (!response.ok) return res.status(502).json({ error: `AI Service Error: ${response.statusText || await response.text()}` });
    return res.json(await response.json());
}));

module.exports = router;
