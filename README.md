# ai-diving

## docker hub webhook

直接在docker hub webhook中添加以下url即可（邮箱需要填写真正的邮箱）：

- `notify_force`: 是否强制推送，如果为true，则无论分析结论是否与上一次一致，都会推送。
- `notify_data`: 接收邮箱

`https://ai-diving.npmtrend.com/api/docker/analyze?token=bae95b6d-ed59-4516-b43d-ad39e493957f&notify_type=email&notify_data=你的邮箱&notify_force=true`


## curl test

```bash
curl -v -XPOST -d '{
  "push_data": {
    "tag": "latest"
  },
  "repository": {
    "repo_name": "vicanso/static"
  }
}' -H 'Content-Type: application/json' 'https://ai-diving.npmtrend.com/api/docker/analyze?token=bae95b6d-ed59-4516-b43d-ad39e493957f&notify_type=email&notify_data=你的邮箱&notify_force=true'
```


## dev
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