# Excel DB Manager

Excel fayllarını bir mərkəzi web paneldən yükləmək, sheet-ləri görmək və böyük dataları səhifələnmiş cədvəl kimi oxumaq üçün FastAPI əsaslı tətbiq.

## Funksiyalar

- `.xlsx`, `.xlsm`, `.xltx`, `.xltm`, `.xls` fayl importu
- Hər workbook üçün sheet siyahısı, sətir və sütun sayı
- Ayrı `Fayllar` səhifəsi: yüklənən fayllar, status, endirmə, silmə və yenidən import
- Default bölmələr: `AZ-MDB`, `AZ-Rayonlar`, `AZ-Respublika`, `EN-MDB`, `EN-Rayonlar`, `EN-Respublika`
- Faylları bölmələrə əlavə etmək, upload zamanı bölmə seçmək və sonradan bölməni dəyişmək
- Admin rejimi: fayl yükləmə, silmə, hamısını silmə, yenidən import, bölmə əlavə/silmə və faylı bölməyə keçirmə yalnız admin üçün açıqdır
- Adi istifadəçi girişsiz baxa, axtara, sheet-lərə baxa, merge panelindən istifadə edə və orijinal faylı endirə bilər
- Ayrı `Cədvəllər` səhifəsi: fayl və sheet seçimi, sheet daxilində axtarış
- `Birləşmiş data` səhifəsi: bütün hazır Excel sheet-lərindən gələn dataları file/sheet/sətir məlumatı ilə birlikdə göstərir
- Xüsusi merge: istədiyiniz yüklənmiş faylları seçib yalnız onlardan birləşdirilmiş görünüş almaq
- Böyük sheet-lər üçün `50-1000` sətirlik səhifələmə
- Background import statusu və progress göstəricisi
- Orijinal Excel faylını serverdə saxlama və yenidən endirmə
- Fayl silmə və yenidən import üçün API
- SQLite `WAL` rejimi ilə sadə deploy və stabil oxuma
- İstəyə bağlı Basic Auth: `APP_USERNAME` və `APP_PASSWORD`

## Admin giriş

Serverdə `APP_USERNAME` və `APP_PASSWORD` təyin olunubsa, yazma/silmə əməliyyatları yalnız admin login ilə işləyir. Daha ayrıca adlandırma istəsəniz `APP_ADMIN_USERNAME` və `APP_ADMIN_PASSWORD` də istifadə oluna bilər.

```bash
APP_USERNAME=admin
APP_PASSWORD=strong-password
```

Bu dəyişənlər boşdursa, admin rejimi açılmır. Lokal development üçün `.env` faylında bunlar var:

```bash
APP_USERNAME=admin
APP_PASSWORD=change-this-password
```

Parolu dəyişəndən sonra serveri restart edin.

Qeyd: tətbiq əsasən Excel datalarını göstərir. Hüceyrə formatları, rənglər, chart-lar və formul nəticələrinin Excel tərəfindən hesablanması ayrıca render edilmir; formul hüceyrələri formul mətni kimi saxlanır.

## Lokal işə salma

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
```

Windows PowerShell üçün:

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
```

Panel: `http://localhost:8000`

## Docker ilə deploy

```bash
docker compose up -d --build
```

Serverdə giriş üçün `docker-compose.yml` içində bunları aktiv edin:

```yaml
APP_USERNAME: admin
APP_PASSWORD: strong-password
```

## Ubuntu serverdə systemd deploy

```bash
sudo mkdir -p /opt/excel-db-manager
sudo rsync -a ./ /opt/excel-db-manager/
cd /opt/excel-db-manager
python3 -m venv .venv
. .venv/bin/activate
pip install -r requirements.txt
sudo cp deploy/excel-db-manager.service /etc/systemd/system/excel-db-manager.service
sudo systemctl daemon-reload
sudo systemctl enable --now excel-db-manager
sudo systemctl status excel-db-manager
```

Nginx reverse proxy nümunəsi:

```nginx
server {
    server_name your-domain.com;

    client_max_body_size 2G;

    location / {
        proxy_pass http://127.0.0.1:8000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

## Məlumat saxlanması

- `data/app.db`: metadata və sheet sətirləri
- `uploads/`: orijinal Excel faylları

Backup üçün bu iki qovluğu birlikdə saxlayın.
