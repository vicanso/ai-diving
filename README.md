# ai-diving


```bash
docker pull postgres:18-alpine

docker run -d --restart=always \
  -v $PWD/postgres:/var/lib/postgresql \
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