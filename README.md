# ai-diving



```bash
docker run -d --restart=always \
  -p 5010:5000 \
  -e RUST_ENV=production \
  -e AIDIVING__REDIS__URI=redis://172.18.230.75:6379 \
  -e AIDIVING__DATABASE__URI=postgres://vicanso:***@172.18.230.75:5432/aidiving \
  -e AIDIVING__SESSION__SECRET=*** \
  --name=ai-diving \
  vicanso/ai-diving
```

```bash
docker pull postgres:18-alpine

docker run -d --restart=always \
  -v /opt/ai-diving/postgres:/var/lib/postgresql \
  -e POSTGRES_PASSWORD=A123456 \
  -p 5432:5432 \
  --name=ai-diving-postgres \
  postgres:18-alpine

docker exec -it ai-diving-postgres sh

psql -c "CREATE DATABASE aidiving;" -U postgres
psql -c "CREATE USER vicanso WITH PASSWORD 'A123456';" -U postgres
psql -c "GRANT ALL PRIVILEGES ON DATABASE aidiving to vicanso;" -U postgres
psql -c "GRANT ALL ON DATABASE aidiving TO vicanso;" -U postgres
psql -c "ALTER DATABASE aidiving OWNER TO vicanso;" -U postgres
```