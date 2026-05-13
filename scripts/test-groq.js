(async () => {
  const key = process.env.VITE_GROQ_API_KEY || process.env.GROQ_API_KEY;
  if (!key) {
    console.error('No GROQ API key found. Set VITE_GROQ_API_KEY in the environment.');
    process.exit(2);
  }

  const prompt = 'Return a one-line JSON: {"artifacts": [{"title":"Test","category":"Test","content":"OK","tags":["test"]}]}';
  const models = ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant'];

  try {
    let lastText = '';
    for (const model of models) {
      const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${key}`,
        },
        body: JSON.stringify({
          model,
          messages: [{ role: 'user', content: prompt }],
          temperature: 0.0,
        }),
      });

      console.log('Model', model, 'HTTP', res.status, res.statusText);
      const text = await res.text();
      lastText = text;
      console.log('Response body:', text.slice(0, 2000));
      if (res.ok) {
        console.log('\nGroq test request succeeded.');
        process.exit(0);
      }
      if (!text.toLowerCase().includes('model_decommissioned')) break;
    }

    process.exit(3);
  } catch (err) {
    console.error('Request failed:', err.message || err);
    process.exit(4);
  }
})();
