import 'dotenv/config';
import { buildApp } from './app';
import { ensureBucket } from './lib/minio';

const app = buildApp();
const port = Number(process.env.PORT ?? 3000);

ensureBucket()
  .then(() => app.listen({ port, host: '0.0.0.0' }))
  .catch((err) => {
    app.log.error(err);
    process.exit(1);
  });
