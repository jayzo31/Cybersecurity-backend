const express = require('express');
const app = express();
const port = process.env.PORT || 3001;

app.use(express.json());

app.get('/api/health', (req, res) => {
  res.status(200).json({ status: 'healthy', message: 'Backend is running!' });
});

app.listen(port, () => {
  console.log(`Backend server listening on port ${port}`);
});
