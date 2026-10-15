import { query } from './index.js';

/**
 * Sample topic-wise MCQ quizzes (frontend roadmap). Add more entries to this
 * array to grow the quiz bank - `npm run seed` is idempotent and only inserts
 * quizzes that do not exist yet. A quiz is skipped if its roadmap/topic is not
 * in the database.
 *
 * Question format: { q, explanation, options: [...], correct: <index in options> }
 */
export const QUIZZES = [
  {
    roadmap: 'frontend',
    topic: '100-internet',
    title: 'Internet Basics',
    description: 'How the internet, DNS and HTTP work.',
    pass: 60,
    questions: [
      {
        q: 'What does DNS do?',
        explanation: 'DNS translates human friendly domain names (example.com) into IP addresses.',
        options: [
          'Encrypts web traffic',
          'Translates domain names into IP addresses',
          'Stores website files',
          'Speeds up the CPU',
        ],
        correct: 1,
      },
      {
        q: 'Which protocol is used for secure web traffic?',
        explanation: 'HTTPS is HTTP over TLS, so data between browser and server is encrypted.',
        options: ['FTP', 'HTTP', 'HTTPS', 'SMTP'],
        correct: 2,
      },
      {
        q: 'Which HTTP status code means "Not Found"?',
        explanation: '404 is returned when the server cannot find the requested resource.',
        options: ['200', '301', '404', '500'],
        correct: 2,
      },
      {
        q: 'What is web hosting?',
        explanation: 'Hosting means your site files live on a server that is always connected to the internet.',
        options: [
          'Buying a domain name',
          'Writing HTML code',
          'Storing website files on a server connected to the internet',
          'Installing a browser',
        ],
        correct: 2,
      },
      {
        q: 'What does a browser send to a server to get a web page?',
        explanation: 'The browser sends an HTTP request and the server answers with an HTTP response.',
        options: ['An HTTP request', 'A DNS record', 'A CSS file', 'A cookie banner'],
        correct: 0,
      },
    ],
  },
  {
    roadmap: 'frontend',
    topic: '101-html',
    title: 'HTML Fundamentals',
    description: 'Tags, attributes and semantic HTML.',
    pass: 60,
    questions: [
      {
        q: 'What does HTML stand for?',
        explanation: 'HTML = HyperText Markup Language, the structure layer of a web page.',
        options: [
          'HighText Machine Language',
          'HyperText Markup Language',
          'Hyperlinks and Text Markup Language',
          'Home Tool Markup Language',
        ],
        correct: 1,
      },
      {
        q: 'Which element defines the largest (most important) heading?',
        explanation: 'Headings go from <h1> (most important) down to <h6>.',
        options: ['<heading>', '<h6>', '<h1>', '<head>'],
        correct: 2,
      },
      {
        q: 'Which attribute provides alternative text for an image?',
        explanation: 'alt is read by screen readers and shown if the image fails to load.',
        options: ['title', 'alt', 'src', 'name'],
        correct: 1,
      },
      {
        q: 'Which tag creates a hyperlink?',
        explanation: 'The anchor element <a> with an href attribute creates links.',
        options: ['<link>', '<href>', '<a>', '<url>'],
        correct: 2,
      },
      {
        q: 'Which of these is a semantic HTML element?',
        explanation: '<article> describes its meaning; <div> and <span> are generic containers.',
        options: ['<div>', '<span>', '<article>', '<b>'],
        correct: 2,
      },
    ],
  },
  {
    roadmap: 'frontend',
    topic: '102-css',
    title: 'CSS Fundamentals',
    description: 'Selectors, the box model and layout basics.',
    pass: 60,
    questions: [
      {
        q: 'What does CSS stand for?',
        explanation: 'CSS = Cascading Style Sheets.',
        options: [
          'Creative Style Sheets',
          'Computer Style Sheets',
          'Cascading Style Sheets',
          'Colorful Style Syntax',
        ],
        correct: 2,
      },
      {
        q: 'Which property changes the text colour of an element?',
        explanation: '`color` sets text colour; `background-color` sets the background.',
        options: ['font-color', 'text-color', 'color', 'foreground'],
        correct: 2,
      },
      {
        q: 'Which selector targets elements with class="box"?',
        explanation: 'Class selectors start with a dot: .box. IDs use a hash: #box.',
        options: ['#box', '.box', 'box', '*box'],
        correct: 1,
      },
      {
        q: 'Ordered from the inside out, what are the layers of the CSS box model?',
        explanation: 'Content, then padding, then border, then margin.',
        options: [
          'Margin, border, padding, content',
          'Content, margin, padding, border',
          'Content, padding, border, margin',
          'Padding, content, margin, border',
        ],
        correct: 2,
      },
      {
        q: 'What is `display: flex` mainly used for?',
        explanation: 'Flexbox lays out items in one dimension (a row or a column) with flexible sizing.',
        options: [
          'Hiding an element',
          'Creating one-dimensional flexible layouts',
          'Adding animations',
          'Loading fonts',
        ],
        correct: 1,
      },
    ],
  },
  {
    roadmap: 'frontend',
    topic: '103-javascript',
    title: 'JavaScript Fundamentals',
    description: 'Variables, types, arrays and JSON.',
    pass: 60,
    questions: [
      {
        q: 'Which keyword declares a block-scoped variable that can be reassigned?',
        explanation: '`let` is block scoped and reassignable; `const` is block scoped but not reassignable.',
        options: ['var', 'let', 'const', 'static'],
        correct: 1,
      },
      {
        q: 'What does `typeof null` return?',
        explanation: 'This is a long-standing JavaScript quirk: typeof null is "object".',
        options: ['"null"', '"undefined"', '"object"', '"number"'],
        correct: 2,
      },
      {
        q: 'Which array method adds an element to the end of an array?',
        explanation: 'push() appends to the end; unshift() adds to the start.',
        options: ['pop()', 'shift()', 'unshift()', 'push()'],
        correct: 3,
      },
      {
        q: 'What is the difference between === and ==?',
        explanation: '=== compares value and type (no coercion); == converts types before comparing.',
        options: [
          'No difference',
          '=== is strict equality without type coercion',
          '== is faster',
          '=== only works on numbers',
        ],
        correct: 1,
      },
      {
        q: 'Which method converts a JSON string into a JavaScript object?',
        explanation: 'JSON.parse() turns text into an object; JSON.stringify() does the reverse.',
        options: ['JSON.stringify()', 'JSON.parse()', 'JSON.toObject()', 'Object.fromJSON()'],
        correct: 1,
      },
    ],
  },
];

export function seedQuizzes(quizzes = QUIZZES) {
  let quizCount = 0;
  let questionCount = 0;

  query.tx(() => {
    for (const quiz of quizzes) {
      const topic = query.get(
        'SELECT 1 AS ok FROM roadmap_topics WHERE roadmap_slug = ? AND topic_key = ?',
        quiz.roadmap,
        quiz.topic,
      );
      if (!topic) continue; // roadmap/topic not seeded -> skip

      const res = query.run(
        `INSERT OR IGNORE INTO quizzes (roadmap_slug, topic_key, title, description, pass_percent)
         VALUES (?, ?, ?, ?, ?)`,
        quiz.roadmap,
        quiz.topic,
        quiz.title,
        quiz.description || null,
        quiz.pass ?? 60,
      );
      if (res.changes === 0) continue; // already exists
      quizCount += 1;

      quiz.questions.forEach((question, qi) => {
        const q = query.run(
          `INSERT INTO quiz_questions (quiz_id, question_text, explanation, order_index)
           VALUES (?, ?, ?, ?)`,
          res.lastInsertRowid,
          question.q,
          question.explanation || null,
          qi + 1,
        );
        questionCount += 1;
        question.options.forEach((text, oi) => {
          query.run(
            `INSERT INTO quiz_options (question_id, option_text, is_correct, order_index)
             VALUES (?, ?, ?, ?)`,
            q.lastInsertRowid,
            text,
            oi === question.correct ? 1 : 0,
            oi + 1,
          );
        });
      });
    }
  });

  return { quizzes: quizCount, questions: questionCount };
}