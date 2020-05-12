const express = require('express');
const dotenv = require('dotenv');

dotenv.config();

const router = express.Router();

router.get('/:url', async (req, res) => {
  const url = +req.params.url;
});

module.exports = router;
