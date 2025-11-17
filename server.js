import express from 'express';
import cors from 'cors';
import jwt from 'jsonwebtoken';
import path from 'path';
import { fileURLToPath } from 'url';

const app = express();
const PORT = process.env.PORT || 4000;      // important for hosting
const JWT_SECRET = 'super-secret-demo-key'; // change in real app

app.use(cors());
app.use(express.json());

// For serving index.html later:
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// --------- DEMO DATA (in-memory) ----------

// Users (hardcoded for demo)
const users = [
  {
    id: 1,
    role: 'CANDIDATE',
    email: 'candidate1@example.com',
    password: 'password',
    name: 'Alice Candidate',
    phone: '1234567890'
  },
  {
    id: 2,
    role: 'INSTRUCTOR',
    email: 'instructor1@example.com',
    password: 'password',
    name: 'Ian Instructor',
    phone: '2222222222'
  },
  {
    id: 3,
    role: 'ADMIN',
    email: 'admin1@example.com',
    password: 'password',
    name: 'Adam Admin',
    phone: '3333333333'
  }
];

// For demo, instructors are just users with role INSTRUCTOR
const instructors = [
  {
    id: 2,
    name: 'Ian Instructor',
    vehicleType: 'manual',
    // very simple working hours: slots per day
    slots: ['09:00', '11:00', '14:00', '16:00']
  }
];

// in-memory state
let lessons = [];      // lesson objects
let feedbacks = [];    // feedback objects
let invoices = [];     // invoice objects
let nextLessonId = 1;
let nextInvoiceId = 1;

// --------- AUTH MIDDLEWARE ----------

function authMiddleware(req, res, next) {
  const authHeader = req.headers['authorization'];
  if (!authHeader) return res.status(401).json({ error: 'Missing Authorization header' });

  const token = authHeader.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Invalid Authorization header' });

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded; // { id, email, role, name }
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid token' });
  }
}

function requireRole(role) {
  return (req, res, next) => {
    if (req.user.role !== role) {
      return res.status(403).json({ error: 'Forbidden: insufficient role' });
    }
    next();
  };
}

// --------- AUTH ROUTES ----------

app.post('/api/login', (req, res) => {
  const { email, password } = req.body;

  const user = users.find(u => u.email === email && u.password === password);
  if (!user) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  const token = jwt.sign(
    { id: user.id, email: user.email, role: user.role, name: user.name },
    JWT_SECRET,
    { expiresIn: '8h' }
  );

  res.json({
    token,
    user: {
      id: user.id,
      email: user.email,
      role: user.role,
      name: user.name
    }
  });
});

app.get('/api/me', authMiddleware, (req, res) => {
  const user = users.find(u => u.id === req.user.id);
  res.json({
    id: user.id,
    email: user.email,
    role: user.role,
    name: user.name,
    phone: user.phone
  });
});

// --------- INSTRUCTORS & AVAILABILITY ----------

// List instructors (for candidate to choose)
app.get('/api/instructors', authMiddleware, (req, res) => {
  res.json(instructors);
});

// Check availability for an instructor on a date
// GET /api/availability?instructorId=2&date=2025-11-18
app.get('/api/availability', authMiddleware, (req, res) => {
  const instructorId = parseInt(req.query.instructorId, 10);
  const date = req.query.date; // 'YYYY-MM-DD'

  const instructor = instructors.find(i => i.id === instructorId);
  if (!instructor) return res.status(404).json({ error: 'Instructor not found' });

  // find lessons already booked for that instructor and date
  const existing = lessons.filter(
    l => l.instructorId === instructorId && l.date === date && l.status !== 'CANCELLED'
  );

  const bookedTimes = existing.map(l => l.time);

  // available slots = slots not in bookedTimes
  const available = instructor.slots.filter(t => !bookedTimes.includes(t));

  res.json({
    instructorId,
    date,
    availableSlots: available
  });
});

// --------- LESSONS ----------

// Candidate books a lesson
// POST /api/lessons { instructorId, date, time, lessonType, pickupLocation }
app.post('/api/lessons', authMiddleware, requireRole('CANDIDATE'), (req, res) => {
  const { instructorId, date, time, lessonType, pickupLocation } = req.body;

  const instructor = instructors.find(i => i.id === instructorId);
  if (!instructor) return res.status(404).json({ error: 'Instructor not found' });

  if (!instructor.slots.includes(time)) {
    return res.status(400).json({ error: 'Time not in instructor working slots' });
  }

  // check for duplicate booking
  const clash = lessons.find(
    l => l.instructorId === instructorId && l.date === date && l.time === time && l.status !== 'CANCELLED'
  );
  if (clash) return res.status(400).json({ error: 'Slot already booked' });

  const lesson = {
    id: nextLessonId++,
    candidateId: req.user.id,
    instructorId,
    date,
    time,
    lessonType: lessonType || 'Standard',
    pickupLocation: pickupLocation || 'Driving school office',
    status: 'BOOKED',
    price: 50 // flat for demo
  };

  lessons.push(lesson);
  res.status(201).json(lesson);
});

// Get lessons
// - Candidate: their lessons only
// - Instructor: their lessons only
// - Admin: all lessons (with optional filters)
app.get('/api/lessons', authMiddleware, (req, res) => {
  const { role, id } = req.user;
  const { date, instructorId, status } = req.query;

  let result = lessons;

  if (role === 'CANDIDATE') {
    result = result.filter(l => l.candidateId === id);
  } else if (role === 'INSTRUCTOR') {
    result = result.filter(l => l.instructorId === id);
  } else if (role === 'ADMIN') {
    // admin can see all, but can filter
    if (instructorId) {
      result = result.filter(l => l.instructorId === parseInt(instructorId, 10));
    }
  }

  if (date) {
    result = result.filter(l => l.date === date);
  }
  if (status) {
    result = result.filter(l => l.status === status);
  }

  // enrich with names
  const enriched = result.map(l => ({
    ...l,
    candidateName: users.find(u => u.id === l.candidateId)?.name || 'Unknown',
    instructorName: users.find(u => u.id === l.instructorId)?.name || 'Unknown'
  }));

  res.json(enriched);
});

// Instructor marks lesson as completed
app.post('/api/lessons/:id/complete', authMiddleware, requireRole('INSTRUCTOR'), (req, res) => {
  const lessonId = parseInt(req.params.id, 10);
  const lesson = lessons.find(l => l.id === lessonId);
  if (!lesson) return res.status(404).json({ error: 'Lesson not found' });
  if (lesson.instructorId !== req.user.id) {
    return res.status(403).json({ error: 'You can only update your own lessons' });
  }

  lesson.status = 'COMPLETED';
  res.json(lesson);
});

// Instructor adds feedback
// POST /api/lessons/:id/feedback { rating, comments }
app.post('/api/lessons/:id/feedback', authMiddleware, requireRole('INSTRUCTOR'), (req, res) => {
  const lessonId = parseInt(req.params.id, 10);
  const { rating, comments } = req.body;

  const lesson = lessons.find(l => l.id === lessonId);
  if (!lesson) return res.status(404).json({ error: 'Lesson not found' });
  if (lesson.instructorId !== req.user.id) {
    return res.status(403).json({ error: 'You can only give feedback for your own lessons' });
  }

  const feedback = {
    id: feedbacks.length + 1,
    lessonId,
    instructorId: req.user.id,
    rating: rating || 5,
    comments: comments || ''
  };

  feedbacks.push(feedback);
  lesson.status = 'COMPLETED';

  res.status(201).json({ lesson, feedback });
});

// --------- INVOICES (ADMIN) ----------

// Generate invoice for a candidate for all COMPLETED, not-yet-invoiced lessons
// POST /api/invoices/generate { candidateId }
app.post('/api/invoices/generate', authMiddleware, requireRole('ADMIN'), (req, res) => {
  const { candidateId } = req.body;
  const candidate = users.find(u => u.id === candidateId && u.role === 'CANDIDATE');
  if (!candidate) return res.status(404).json({ error: 'Candidate not found' });

  // Find completed lessons for this candidate that are not invoiced yet
  const candidateLessons = lessons.filter(
    l => l.candidateId === candidateId && l.status === 'COMPLETED' && !l.invoiceId
  );

  if (candidateLessons.length === 0) {
    return res.status(400).json({ error: 'No completed lessons to invoice' });
  }

  const totalAmount = candidateLessons.reduce((sum, l) => sum + (l.price || 0), 0);

  const invoice = {
    id: nextInvoiceId++,
    invoiceNumber: `INV-${Date.now()}`,
    candidateId,
    candidateName: candidate.name,
    totalAmount,
    status: 'DRAFT',
    createdAt: new Date().toISOString()
  };

  invoices.push(invoice);

  // link lessons to invoice
  candidateLessons.forEach(l => {
    l.invoiceId = invoice.id;
  });

  res.status(201).json({ invoice, lessons: candidateLessons });
});

// List invoices (admin only)
app.get('/api/invoices', authMiddleware, requireRole('ADMIN'), (req, res) => {
  res.json(invoices);
});

// --------- STATIC FRONTEND ----------

// Serve files from /public
app.use(express.static(path.join(__dirname, 'public')));

// For any non-API route, send index.html (single-page app style)
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// --------- START SERVER ----------

app.listen(PORT, () => {
  console.log(`Driving school demo app running on http://localhost:${PORT}`);
});
