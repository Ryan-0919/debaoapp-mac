import os
import secrets
from pathlib import Path

os.umask(0o077)
config = Path('/etc/debao')
config.mkdir(mode=0o700, exist_ok=True)
api = config / 'api.env'
if api.exists():
    raise SystemExit('Existing environment preserved; refusing to replace credentials')
password = secrets.token_hex(24)
admin_password = secrets.token_urlsafe(24)
(config / 'postgres.env').write_text(f'POSTGRES_DB=debao\nPOSTGRES_USER=debao\nPOSTGRES_PASSWORD={password}\n')
values = {
    'NODE_ENV': 'production', 'HOST': '127.0.0.1', 'PORT': '4100',
    'DATABASE_URL': f'postgres://debao:{password}@127.0.0.1:55432/debao',
    'REDIS_URL': 'redis://127.0.0.1:56379',
    'DEBAO_AUTH_SECRET': secrets.token_hex(32),
    'DEBAO_ADMIN_USERNAME': 'admin', 'DEBAO_ADMIN_PASSWORD': admin_password,
    'DEBAO_ADMIN_MFA_REQUIRED': 'true',
    'ADMIN_INIT_USERNAME': 'admin', 'ADMIN_INIT_PASSWORD': admin_password,
    'POLYV_AUTH_CALLBACK_URL': 'https://debao-api.denlaw.cn/v1/live/polyv/authorize',
}
for adapter in ['PAYMENT', 'SMS', 'PUSH', 'GRADING', 'AI', 'MEDIA', 'WECHAT_AUTH', 'CARRIER_AUTH']:
    values[f'{adapter}_ADAPTER'] = 'unconfigured'
source = config / 'polyv-import.env'
if source.exists():
    for line in source.read_text(encoding='utf-8-sig').splitlines():
        key, separator, value = line.partition('=')
        if separator and key in ['POLYV_USER_ID', 'POLYV_APP_ID', 'POLYV_APP_SECRET', 'POLYV_AUTH_SECRET'] and value.strip():
            values[key] = value.strip().strip('\"').strip("'")
api.write_text(''.join(f'{key}={value}\n' for key, value in values.items()))
(config / 'admin-login.txt').write_text(f'URL: https://debao-admin.denlaw.cn/login\nUsername: admin\nPassword: {admin_password}\nFirst login requires authenticator enrollment.\n')
print('Environment and administrator credentials generated (not displayed).')
