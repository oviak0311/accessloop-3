// Admin API: every route here needs the admin passcode.
import { Router } from 'express';
import crypto from 'node:crypto';
import { prisma } from '../lib/prisma.js';
import { HttpError, parseId, parseEnum, parseOptionalText, requireObjectBody } from '../lib/http.js';
import {
  ALL_STATUSES,
  CLOSED_STATUSES,
  FIXED_STATUSES,
  NOTE_REQUIRED,
  STATUS_LABELS,
  checkTransition,
} from '../lib/rules.js';
import { formatReport, formatHistory, formatResponses } from '../lib/format.js';

const router = Router();

// Checks the X-Admin-Passcode header against the ADMIN_PASSCODE environment variable.
function requirePasscode(req, res, next) {
  const expected = process.env.ADMIN_PASSCODE;
  if (!expected) {
    throw new HttpError(500, 'The admin passcode isn’t set up on the server.');
  }
  const given = req.get('x-admin-passcode') ?? '';
  const a = crypto.createHash('sha256').update(given).digest();
  const b = crypto.createHash('sha256').update(expected).digest();
  if (!crypto.timingSafeEqual(a, b)) {
    throw new HttpError(401, 'Incorrect admin passcode.');
  }
  next();
}

router.use(requirePasscode);

async function getAdminDetail(id) {
  const report = await prisma.report.findUnique({
    where: { id },
    include: {
      category: true,
      location: true,
      responses: { orderBy: { createdAt: 'desc' } },
      history: { orderBy: { createdAt: 'asc' } },
    },
  });
  if (!report) throw new HttpError(404, 'Report not found.');
  return {
    ...formatReport(report, { forAdmin: true }),
    history: formatHistory(report.history),
    responses: formatResponses(report.responses),
  };
}

// READ: reports that need the team's attention.
// ?view=attention (default): new, flagged or may-have-cleared reports
// ?view=open: every open report
router.get('/reports', async (req, res) => {
  const view = req.query.view ?? 'attention';
  if (!['attention', 'open'].includes(view)) {
    throw new HttpError(400, 'view must be attention or open.');
  }

  const reports = await prisma.report.findMany({
    where: { status: { notIn: CLOSED_STATUSES } },
    include: {
      category: true,
      location: true,
      responses: { select: { value: true, createdAt: true }, orderBy: { createdAt: 'desc' } },
      history: { select: { createdAt: true }, orderBy: { createdAt: 'desc' }, take: 1 },
    },
    orderBy: { createdAt: 'asc' }, // oldest waiting first
  });

  const now = new Date();
  const withReasons = reports.map((r) => {
    const formatted = formatReport(r, { now, forAdmin: true });
    const reasons = [];
    if (formatted.flagged) reasons.push(formatted.riderSays);
    if (formatted.status === 'REPORTED') reasons.push('New report');
    if (formatted.mayHaveCleared) reasons.push('May have cleared');
    return { ...formatted, attentionReasons: reasons };
  });

  const priority = (r) => (r.flagged ? 0 : r.status === 'REPORTED' ? 1 : r.mayHaveCleared ? 2 : 3);
  const list = (view === 'attention' ? withReasons.filter((r) => r.attentionReasons.length) : withReasons).sort(
    (a, b) => priority(a) - priority(b),
  );

  res.json({ count: list.length, reports: list });
});

// UPDATE: change a report's official status, with an optional note.
// Marking a duplicate also uses this route, with duplicateOfId.
router.patch('/reports/:id/status', async (req, res) => {
  const id = parseId(req.params.id, 'Report ID');
  const body = requireObjectBody(req.body);
  const newStatus = parseEnum(body.status, ALL_STATUSES, 'Choose a valid status.');
  const note = parseOptionalText(body.note, 500, 'Note');

  if (NOTE_REQUIRED.includes(newStatus) && !note) {
    throw new HttpError(400, `Add a note explaining why this report is “${STATUS_LABELS[newStatus]}”.`);
  }

  let duplicateOfId = null;
  if (newStatus === 'DUPLICATE') {
    if (body.duplicateOfId === undefined) throw new HttpError(400, 'Choose the original report this one duplicates.');
    duplicateOfId = parseId(body.duplicateOfId, 'duplicateOfId');
    if (duplicateOfId === id) throw new HttpError(400, 'A report can’t be a duplicate of itself.');
  } else if (body.duplicateOfId !== undefined) {
    throw new HttpError(400, 'duplicateOfId is only used when marking a report as a duplicate.');
  }

  // The status change and its history record are saved in one transaction:
  // either both are saved, or neither is.
  await prisma.$transaction(async (tx) => {
    const report = await tx.report.findUnique({ where: { id }, include: { category: true } });
    if (!report) throw new HttpError(404, 'Report not found.');

    const problem = checkTransition(report.category.kind, report.status, newStatus);
    if (problem) throw new HttpError(409, problem);

    if (duplicateOfId) {
      const original = await tx.report.findUnique({ where: { id: duplicateOfId } });
      if (!original) throw new HttpError(400, 'The original report doesn’t exist.');
      if (original.status === 'DUPLICATE') {
        throw new HttpError(400, `Report ${original.id} is itself a duplicate. Point to the original report instead.`);
      }
    }

    await tx.report.update({
      where: { id },
      data: {
        status: newStatus,
        resolvedAt: FIXED_STATUSES.includes(newStatus) ? new Date() : null,
        duplicateOfId,
      },
    });
    await tx.statusChange.create({
      data: { reportId: id, oldStatus: report.status, newStatus, note },
    });
  });

  res.json(await getAdminDetail(id));
});

// DELETE: remove spam or test reports. Their history and responses are deleted too.
router.delete('/reports/:id', async (req, res) => {
  const id = parseId(req.params.id, 'Report ID');
  const report = await prisma.report.findUnique({
    where: { id },
    include: { _count: { select: { duplicates: true } } },
  });
  if (!report) throw new HttpError(404, 'Report not found.');
  if (report._count.duplicates > 0) {
    throw new HttpError(
      409,
      'Other reports are marked as duplicates of this one. It’s a real barrier, so close it with a status instead of deleting it.',
    );
  }

  await prisma.report.delete({ where: { id } });
  res.json({ deleted: id, message: 'Report deleted, along with its history and responses.' });
});

export default router;
