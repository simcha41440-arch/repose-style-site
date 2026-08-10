// Vercel's Node runtime sometimes pre-parses the body (as an object
// or a raw string) and sometimes leaves the raw request stream
// untouched, depending on config. This helper handles both cases and
// always resolves to a plain object, rejecting on malformed JSON
// instead of letting a route crash on bad input.
function parseJsonBody(req) {
  return new Promise((resolve, reject) => {
    if (req.body !== undefined && req.body !== null) {
      if (typeof req.body === 'string') {
        if (!req.body.length) {
          resolve({});
          return;
        }
        try {
          resolve(JSON.parse(req.body));
        } catch (err) {
          reject(new Error('Invalid JSON body.'));
        }
      } else {
        resolve(req.body);
      }
      return;
    }

    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
      if (data.length > 1e6) {
        req.destroy();
        reject(new Error('Payload too large.'));
      }
    });
    req.on('end', () => {
      if (!data) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(data));
      } catch (err) {
        reject(new Error('Invalid JSON body.'));
      }
    });
    req.on('error', reject);
  });
}

module.exports = { parseJsonBody };
