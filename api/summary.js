/**
 * Vercel Serverless Function — AI Summary Generator
 * POST /api/summary
 * Body: { tasks: [...], date: "2026-05-21" }
 * Returns: { summary: "..." }
 */

const https = require('https');

function httpsPost(hostname, path, headers, body) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const opts = {
      hostname, path, method: 'POST',
      headers: { ...headers, 'Content-Length': Buffer.byteLength(payload) }
    };
    const req = https.request(opts, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error('Parse error: ' + data.slice(0, 200))); }
      });
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

function buildPrompt(tasks, date) {
  const active = tasks.filter(t => t.status !== 'Complete');
  const byProject = {};
  active.forEach(t => {
    const p = t.project || 'Other';
    if (!byProject[p]) byProject[p] = [];
    byProject[p].push(t);
  });

  let taskText = '';
  Object.entries(byProject).forEach(([proj, list]) => {
    taskText += `\n### ${proj}\n`;
    list.forEach(t => {
      taskText += `- [${t.status}] ${t.taskName}`;
      if (t.assignees && t.assignees.length) taskText += ` (${t.assignees.join(', ')})`;
      if (t.priority && t.priority !== 'Medium') taskText += ` [${t.priority}]`;
      if (t.endDate) taskText += ` due:${t.endDate}`;
      taskText += '\n';
    });
  });

  const blocked = tasks.filter(t => t.status === 'Blocked');
  const inProgress = tasks.filter(t => t.status === 'In Progress');
  const complete = tasks.filter(t => t.status === 'Complete');

  return `คุณเป็น IT Manager ของ Thana Digital Life (TDL) กำลังสรุปงานให้ผู้บริหาร

วันที่: ${date}
สถิติรวม: In Progress ${inProgress.length} งาน, Blocked ${blocked.length} งาน, Complete ${complete.length} งาน, รวม ${tasks.length} งาน

งานทั้งหมด:
${taskText}

กรุณาสรุปเป็น 4 หัวข้อสั้นๆ ภาษาไทย สำหรับผู้บริหาร:
1. 📊 ภาพรวม — สถานะโดยรวมของทีม IT วันนี้ (1 ประโยค)
2. ✅ ความคืบหน้า — งานสำคัญที่กำลังดำเนินการหรือใกล้เสร็จ (1-2 ประโยค)
3. 🚨 ความเสี่ยง — blockers หรืองานที่ต้องระวัง (1 ประโยค หรือ "ไม่มี blocker")
4. 🎯 จุดโฟกัส — สิ่งที่ผู้บริหารควรให้ความสนใจหรือ approve (1 ประโยค)

ตอบกระชับ ตรงประเด็น ไม่ต้องมี disclaimer หรือคำนำ`;
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }
  if (req.method !== 'POST') { res.status(405).json({ error: 'POST only' }); return; }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    res.status(200).json({ summary: buildFallback(req.body?.tasks || [], req.body?.date || '') });
    return;
  }

  try {
    const { tasks = [], date = new Date().toISOString().split('T')[0] } = req.body || {};
    const prompt = buildPrompt(tasks, date);

    const result = await httpsPost(
      'api.anthropic.com',
      '/v1/messages',
      {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      {
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 600,
        messages: [{ role: 'user', content: prompt }]
      }
    );

    if (result.error) throw new Error(result.error.message);
    const summary = result.content?.[0]?.text ?? 'ไม่สามารถสร้างสรุปได้';
    res.status(200).json({ summary });
  } catch (err) {
    console.error('[summary api]', err);
    // fallback to template
    const { tasks = [], date = '' } = req.body || {};
    res.status(200).json({ summary: buildFallback(tasks, date) });
  }
};

function buildFallback(tasks, date) {
  const inProgress = tasks.filter(t => t.status === 'In Progress').length;
  const blocked = tasks.filter(t => t.status === 'Blocked').length;
  const complete = tasks.filter(t => t.status === 'Complete').length;
  const projects = [...new Set(tasks.map(t => t.project).filter(Boolean))];

  const blockedTasks = tasks.filter(t => t.status === 'Blocked');
  const blockText = blockedTasks.length
    ? `🚨 ความเสี่ยง — มี ${blocked} งานที่ติดขัด: ${blockedTasks.map(t => t.taskName).join(', ')}`
    : '🚨 ความเสี่ยง — ไม่มี blocker วันนี้';

  return `📊 ภาพรวม — ทีม IT มีงานที่กำลังดำเนินการ ${inProgress} งาน ใน ${projects.length} โปรเจกต์

✅ ความคืบหน้า — โปรเจกต์หลักที่ active: ${projects.join(', ')} มีงานเสร็จแล้ว ${complete} งาน

${blockText}

🎯 จุดโฟกัส — ติดตามความคืบหน้า ${projects[0] || 'ทุกโปรเจกต์'} และ review งานที่ Pending Review`;
}
