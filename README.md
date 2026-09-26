# Competition Odds

Takım adını yazınca o takımın **bir sonraki maçını** bulur ve tek ekranda gösterir:

- Ev sahibi / misafir, lig, stat, şehir ve maç saatindeki **hava durumu**
- Her iki takım için: **son 5 maç**, **galibiyet/beraberlik/mağlubiyet**, **iç saha / dış saha formu**,
  **alt/üst istatistikleri**, **sonraki maçlar**
- İki takımın **aralarındaki son maçlar** ve **puan durumu**
- Maç sonucu (1/X/2) ve 2.5 alt/üst **oranları**
- **Tahmin modeli** (Poisson) ve faktör kartlarıyla **maç analizi**
- **Favori takımlar**

> Tahminler geçmiş verilere dayalı istatistiktir, kesin sonuç değildir.

## Veri kaynakları (hepsi ücretsiz)

| Veri | Kaynak |
|---|---|
| Maçlar, skorlar, puan durumu, aralarındaki maçlar | [football-data.org](https://www.football-data.org) |
| Oranlar | [The Odds API](https://the-odds-api.com) (ayda 500 kredi) |
| Hava durumu | [Open-Meteo](https://open-meteo.com) (anahtar gerekmez) |

**Kapsanan ligler:** Premier Lig, Championship, La Liga, Serie A, Bundesliga, Ligue 1, Eredivisie,
Primeira Liga, Brezilya Serie A, Şampiyonlar Ligi.

**Ücretsiz kaynaklarda olmayanlar:** Süper Lig, sakat ve cezalı oyuncu listeleri.

## Kurulum

1. Node.js 18 veya üstü: https://nodejs.org
2. Bağımlılıklar:
   ```bash
   npm install
   ```
3. `.env` dosyasına anahtarları yazın (şablon: `.env.example`):
   ```
   FOOTBALL_DATA_TOKEN=...   # https://www.football-data.org/client/register
   ODDS_API_KEY=...          # https://the-odds-api.com (boş bırakılırsa oranlar gösterilmez)
   ```
4. Başlatın ve http://localhost:3000 adresini açın:
   ```bash
   npm start
   ```

`FOOTBALL_DATA_TOKEN` girilmezse uygulama **demo modunda** çalışır (hayali takımlar: "Demo Spor", "Örnek FK").

## Klasör yapısı

```
competition-odds/
├─ server/
│  ├─ index.js        Express sunucu ve API uçları (/api/teams, /api/match/:teamId)
│  ├─ config.js       Desteklenen ligler ve oran servisindeki karşılıkları
│  ├─ footballData.js football-data.org istekleri (dakikada 10 istek sınırına uyar)
│  ├─ teamIndex.js    Takım arama listesi (server/.cache/teams.json içinde 7 gün saklanır)
│  ├─ oddsApi.js      The Odds API oranları ve maç eşleştirme
│  ├─ weather.js      Open-Meteo hava durumu
│  ├─ report.js       Tüm verileri birleştirip maç raporunu oluşturur
│  └─ cache.js        Bellek içi önbellek
├─ public/            Arayüz (index.html, css, js)
├─ _yedek/            Önceki sürümler (API-Football sürümü dahil)
├─ .env.example
└─ package.json
```

## Telefon uygulaması (PWA / APK)

Uygulama PWA olarak paketlenmiştir: `manifest.webmanifest`, `sw.js` (çevrimdışı önbellek) ve simgeler `public/icons` içindedir.

- **Kurulum:** `https` adresinden açıp tarayıcı menüsünden "Uygulamayı yükle" / "Ana Ekrana Ekle".
- **APK:** Yayındaki `https` adresi https://www.pwabuilder.com adresine verilerek Android paketi üretilebilir.
- Kurulum `http` adreslerde çalışmaz (yalnızca `localhost` istisnadır).

## Yayına alma (Render, ücretsiz)

1. Proje dosyaları GitHub'a yüklenir (`node_modules` ve `.env` hariç; `.gitignore` bunları zaten dışlar).
2. Render'da **New → Web Service** ile depo seçilir. `render.yaml` ayarları taşır:
   - Build: `npm install --omit=dev`
   - Start: `node server/index.js`
3. Render panelinde ortam değişkenleri girilir: `FOOTBALL_DATA_TOKEN`, isteğe bağlı `ODDS_API_KEY`.
4. `server/teams-seed.json` sayesinde sunucu ilk açılışta takım listesini API'den çekmez.

Ücretsiz planda uygulama bir süre kullanılmazsa uykuya geçer; ilk açılış yavaş olabilir.

## Notlar

- **İlk başlatma:** Takım arama listesi için 9 ligin takımları çekilir. football-data.org dakikada 10 istek
  verdiği için sunucu açıldıktan sonra ilk aramanın hazır olması yaklaşık 1 dakika sürebilir.
- **İstek kullanımı:** Bir maç raporu football-data.org'a yaklaşık 4 istek atar ve 30 dakika önbelleğe alınır.
  Oranlar lig başına tek istekle gelir ve 6 saat saklanır; ücretsiz 500 aylık kredi normal kullanım için yeterlidir.
- **Hava durumu** maça 15 günden az kaldığında görünür; şehir takımın adresinden bulunur.
- **Ücretli plana geçiş:** API-Football sürümü `_yedek/api-football-surumu` klasöründedir
  (Süper Lig, sakat ve cezalı oyuncular dahil).
