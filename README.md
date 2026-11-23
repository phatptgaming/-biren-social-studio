# Biren Social Studio

Biren Social Studio là web app tiếng Việt hỗ trợ tạo nội dung bán hàng, quản lý ảnh sản phẩm, xem trước và đăng bài lên Facebook Fanpage.

> **Trạng thái:** luồng Local đã được triển khai và kiểm thử end-to-end với ComfyUI thật trên GPU 6 GB. Gemini và Meta/Facebook chỉ hoạt động sau khi chủ dự án cấu hình credential tương ứng; ứng dụng không giả lập kết nối thành công.

## Công nghệ

- Frontend: React 19, TypeScript, Vite
- Backend: Node.js, Express, REST API
- Database: SQLite (`better-sqlite3`) cho Local
- Nội dung AI: Gemini API server-side
- Hình ảnh AI: ComfyUI API (tùy chọn, mặc định `http://127.0.0.1:8188`)
- Facebook: Meta Graph API + OAuth state chống CSRF

## Yêu cầu

- Node.js 20 trở lên (đã kiểm tra với Node.js 24 trên Windows)
- npm
- Python 3.10–3.12 và Git nếu muốn cài ComfyUI tự động
- ComfyUI chỉ cần khi muốn dùng lựa chọn “AI làm đẹp hình ảnh”
- Meta App và Gemini API Key chỉ cần cho tích hợp tương ứng

## Chạy Local

```powershell
cd E:\Game\BirenSocialStudio
npm install
Copy-Item .env.example .env
npm run dev
```

Mở frontend tại http://localhost:5173. API health ở http://localhost:3001/api/health.

Production local:

```powershell
npm run build
$env:NODE_ENV="production"
npm start
```

Mặc định production server chạy tại http://localhost:3001 và phục vụ frontend đã build cùng API.

## ComfyUI tự động

### Cài đặt một lần

```powershell
npm run comfy:check
npm run comfy:install
powershell -ExecutionPolicy Bypass -File .\scripts\comfyui\Manage-ComfyUI.ps1 -Action model -AcceptModelLicense
npm run comfy:start
```

Script `scripts/comfyui/Manage-ComfyUI.ps1`:

- Kiểm tra Python 3.10–3.12, Git, NVIDIA VRAM và dung lượng ổ đĩa.
- Clone ComfyUI chính thức vào `%LOCALAPPDATA%\BirenSocialStudio\ComfyUI` (ngoài source repo).
- Tạo virtualenv riêng và cài PyTorch CUDA 13 (`cu130`) trước khi cài requirements của ComfyUI.
- Chỉ khởi động tại `127.0.0.1:8188`, không mở cổng Internet.
- Chờ API sẵn sàng, đọc `/system_stats` và `/object_info`.
- Tải model vào `models/checkpoints`, kiểm tra kích thước và SHA-256 trước khi sử dụng.
- Có các action: `check`, `install`, `start`, `stop`, `status`, `model`.

Các lệnh tương ứng:

```powershell
npm run comfy:check
npm run comfy:install
npm run comfy:start
npm run comfy:stop
npm run comfy:status
```

### Model mặc định

| Thuộc tính | Giá trị |
| --- | --- |
| Model | Stable Diffusion v1.5 base |
| File | `v1-5-pruned-emaonly.safetensors` |
| Dung lượng | 4.265.146.304 bytes (~4,27 GB) |
| Nguồn | https://huggingface.co/stable-diffusion-v1-5/stable-diffusion-v1-5 |
| License | CreativeML OpenRAIL-M (cho phép thương mại, kèm các điều khoản hạn chế sử dụng) |
| Yêu cầu VRAM | Tối thiểu 6 GB, batch size 1 |

Manifest đầy đủ nằm tại `scripts/comfyui/model-manifest.json`. Model không nằm trong Git repository. Bản model này không gated và không cần tài khoản trả phí. Nếu dùng model khác, hãy kiểm tra license và đặt đúng trong `ComfyUI/models/checkpoints`.

### Workflow ảnh sản phẩm

Workflow mặc định: `server/providers/workflows/product-enhance.json`.

- `LoadImage` nhận ảnh gốc qua placeholder `__INPUT_IMAGE__`.
- `ImageScaleToTotalPixels` đưa ảnh về khoảng 1 megapixel để phù hợp GPU 6 GB.
- `CheckpointLoaderSimple` nhận checkpoint tự động qua placeholder `__CHECKPOINT__`.
- img2img với `denoise` 0,22, 20 steps, CFG 4,5, seed ngẫu nhiên mỗi lần chạy.
- Prompt ưu tiên giữ hình dáng, bao bì, logo, tên thương hiệu và chữ in trên nhãn.
- `SaveImage` xuất ảnh PNG thật; ứng dụng chỉ lưu và báo hoàn thành sau khi tải được ảnh từ `/view`.

Không cần nhập `COMFYUI_WORKFLOW_JSON` khi dùng workflow mặc định. Nếu dán workflow API format riêng, ứng dụng sẽ kiểm tra `LoadImage`, placeholder `__INPUT_IMAGE__`, input bắt buộc và node output trước khi lưu.

> Lưu ý trung thực: img2img denoise thấp giúp hạn chế thay đổi sản phẩm nhưng không thể bảo đảm tuyệt đối từng ký tự hoặc logo. Hãy dùng chế độ “Giữ nguyên ảnh gốc” khi ảnh cần độ chính xác tuyệt đối.

### Kiểm tra thủ công

```powershell
Invoke-RestMethod http://127.0.0.1:8188/system_stats
Invoke-RestMethod http://127.0.0.1:8188/object_info
```

## Cấu hình môi trường

Không commit `.env`. Hãy sao chép `.env.example` thành `.env` rồi điền các giá trị cần thiết.

### Gemini

Có thể cấu hình trong màn hình **Cài đặt** hoặc bằng biến môi trường:

```env
GEMINI_API_KEY=your-key
GEMINI_MODEL=gemini-2.5-flash
```

API Key nhập qua giao diện được mã hóa AES-256-GCM và lưu trong SQLite local. Khóa mã hóa được lấy từ `APP_ENCRYPTION_KEY`; nếu không có, ứng dụng tự tạo khóa cục bộ trong `.data/.secret-key` (file này bị Git ignore). Không lưu khóa ở localStorage.

### ComfyUI

```env
COMFYUI_URL=http://127.0.0.1:8188
COMFYUI_WORKFLOW_JSON=
COMFYUI_RUNTIME=local
COMFYUI_TIMEOUT_MS=300000
COMFYUI_POLL_MS=1000
COMFYUI_MIN_VRAM_GB=6
COMFYUI_CHECKPOINT=
```

- `COMFYUI_WORKFLOW_JSON`: để trống để dùng workflow Biren mặc định.
- `COMFYUI_MIN_VRAM_GB`: chỉ dùng để hiển thị cảnh báo, không chặn xử lý local.
- `COMFYUI_CHECKPOINT`: tên checkpoint chính xác; nếu trống, ứng dụng chọn checkpoint tương thích đầu tiên từ `/object_info`.

### Meta / Facebook

1. Tạo Meta App loại phù hợp tại https://developers.facebook.com/apps/.
2. Thiết lập Facebook Login/OAuth và callback: `http://localhost:3001/api/facebook/oauth/callback`.
3. Khai báo trong `.env`:

```env
META_APP_ID=your-app-id
META_APP_SECRET=your-app-secret
META_REDIRECT_URI=http://localhost:3001/api/facebook/oauth/callback
META_GRAPH_VERSION=v21.0
```

4. Cấp các quyền tối thiểu: `pages_show_list`, `pages_read_engagement`, `pages_manage_posts`.
5. Vào **Kết nối dịch vụ → Kết nối Facebook**, hoàn thành OAuth và chọn Fanpage trong trình tạo bài.

App Secret và Page Access Token chỉ nằm ở backend; token được mã hóa trong SQLite và không trả về frontend/log. OAuth có `state` ngẫu nhiên, dùng một lần, hết hạn sau 15 phút. Các lời gọi Graph API dùng `appsecret_proof` khi có App Secret. Nếu token hết hạn hoặc quyền bị thu hồi, ứng dụng báo lỗi và yêu cầu kết nối lại.

Meta có thể yêu cầu App Review hoặc tài khoản/role phù hợp trước khi quyền hoạt động trong production. Ứng dụng không tuyên bố hỗ trợ đăng Facebook cá nhân.

## Luồng sử dụng

1. **Tạo bài đăng:** nhập thông tin sản phẩm, hoặc dùng Gemini để tạo nội dung.
2. Chỉnh sửa nội dung, viết lại, rút gọn hoặc tạo phiên bản khác.
3. Tải ảnh JPG/PNG/WebP tối đa 10 MB. Ảnh gốc luôn được giữ lại.
4. Chọn giữ ảnh gốc hoặc xử lý qua ComfyUI; theo dõi tiến trình, so sánh ảnh gốc/output và chọn ảnh muốn dùng.
5. Chọn Fanpage và xem preview.
6. Bấm đăng, xác nhận trong hộp thoại lần cuối.
7. Backend gọi Page Photos API nếu có ảnh, hoặc Page Feed API nếu không có ảnh, rồi lưu lịch sử thành công/thất bại.

Không có retry tự động khi đăng lỗi để tránh đăng trùng.

## API chính

- `GET /api/health`
- `GET /api/status`
- `POST /api/content/generate`
- `POST /api/media/upload`
- `POST /api/media/:fileName/process/start`
- `GET /api/media/process/:jobId`
- `POST /api/media/:fileName/process`
- `GET /api/settings`
- `GET /api/settings/comfy/workflow`
- `GET /api/facebook/oauth/start`
- `GET /api/facebook/oauth/callback`
- `GET /api/facebook/pages`
- `POST /api/posts/publish`
- `GET /api/posts`
- `DELETE /api/posts/:id`

## Dữ liệu và bảo mật

- `.env`, database, khóa cục bộ, upload và `dist` đều bị `.gitignore`.
- Upload giới hạn loại ảnh và 10 MB; server kiểm tra magic bytes thực tế, không tin `Content-Type` từ client.
- Tên file được sinh server-side, phần mở rộng lấy theo MIME đã xác thực và có kiểm tra path traversal.
- Backend validate nội dung, Fanpage và tên file trước khi thao tác.
- Frontend không tự quyết định quyền Facebook và không nhận App Secret/Page Token.
- SQLite local nằm trong `.data/`. Khi triển khai Cloud, filesystem/SQLite có thể mất khi redeploy; nên thay lớp lưu trữ bằng database/secret storage bền vững của nền tảng trước khi dùng production.
- Ảnh người dùng không nằm trong repository.
- Static upload được phục vụ với `X-Content-Type-Options: nosniff`; API trả lỗi JSON rõ ràng.

## Kiểm tra phát triển

```powershell
npm run typecheck
npm run build
npm run check
npm run comfy:check
git diff --check
```

Smoke test local sau khi khởi động server:

```powershell
Invoke-RestMethod http://localhost:3001/api/health
Invoke-RestMethod http://localhost:3001/api/status
```

Khi chưa cấu hình Gemini, ComfyUI hoặc Meta, các endpoint vẫn trả trạng thái rõ ràng và ứng dụng vẫn chạy được ở chế độ viết/chọn ảnh thủ công; không được xem đó là kiểm chứng tài khoản thật.

## Kết quả kiểm thử end-to-end thật (2026-11-23)

Môi trường kiểm thử: Windows, Node.js 24.22.1, ComfyUI clone chính thức, PyTorch 2.14.1+cu130, NVIDIA GeForce RTX 3050 6GB Laptop GPU (6,0 GB VRAM). Checkpoint: `v1-5-pruned-emaonly.safetensors` (SHA-256 đã được script xác minh khi tải).

Quy trình chạy qua API production của ứng dụng, không dùng mock:

1. `POST /api/media/upload` với ảnh sản phẩm PNG 1200×1200 do người kiểm thử tạo.
2. `POST /api/media/:fileName/process/start` để đưa job thật vào ComfyUI.
3. Poll `GET /api/media/process/:jobId`; tiến trình thật tăng từ 35% đến 100%.
4. Tải ảnh kết quả qua URL `/uploads/processed-...png` do backend trả về.

Kết quả ghi nhận:

| Hạng mục | Giá trị |
| --- | --- |
| Job ID | `feacb185-9070-483a-8b7f-ee83c20fde02` |
| Trạng thái | `completed` |
| Checkpoint | `v1-5-pruned-emaonly.safetensors` |
| Workflow | Mặc định (`product-enhance.json`) |
| Ảnh gốc | 1200×1200 PNG, SHA-256 `3a80f008ee2b2569ecde92aadf68a85198524ed1987d069352ba2ecccfeae029d` |
| Ảnh kết quả | 1024×1024 PNG, 503.802 bytes |
| SHA-256 ảnh kết quả | `44389dadc36cb4159e53c3b25d145dd01de1b1f719729841b8783b08f30815a9` |
| Ảnh gốc sau xử lý | Không thay đổi (hash trước và sau giống nhau) |
| Thời gian job | 2026-11-23T12:13:06Z → 2026-11-23T12:13:45Z (khoảng 40 giây) |

Ảnh kết quả đã được mở và kiểm tra trực quan: là ảnh PNG thật do ComfyUI tạo, giữ bố cục và hình dáng chai, đồng thời làm mềm nền/ánh sáng. Với denoise 0,22, các dòng chữ nhỏ trên nhãn vẫn có thể bị biến dạng nhẹ; đây là giới hạn đã biết của img2img và là lý do giao diện luôn cho phép giữ ảnh gốc, so sánh và quay lại ảnh gốc. Không có kết quả nào trong mục này được tạo bằng mock.

Kiểm thử UI trên production build (trình duyệt thật, cùng server và ComfyUI):

- Nhập nội dung, tải ảnh qua file input, thấy preview 1200×1200 và ảnh gốc được đánh dấu `ẢNH GỐC`.
- Bấm **Làm đẹp bằng ComfyUI**; `POST /api/media/:fileName/process/start` trả `202`, thanh tiến trình cập nhật thật đến 100%.
- Giao diện hiển thị cặp so sánh ảnh gốc/output và tự chọn output 1024×1024 `processed-1795436284965-919ac13219.png` (502.592 bytes, SHA-256 `29129fec4bd4002670cbd4d03776e946df431059117aab48220589c091e844b9`).
- Bấm **Giữ nguyên ảnh gốc**: nhãn đổi lại `ẢNH GỐC`, preview quay về đúng ảnh gốc; output vẫn còn để so sánh.
- Trang **Lịch sử bài đăng** hiển thị đúng trạng thái rỗng khi chưa có bài đăng; không có lỗi console trong suốt luồng.

## Local/Cloud và Local Agent

Local mode dùng ComfyUI trên `127.0.0.1` và đã hoạt động. Cloud mode không coi `localhost` của cloud là máy người dùng; ứng dụng sẽ báo rõ khi không thể truy cập.

Không port-forward, không mở public ComfyUI và không tạo tunnel Internet. Khi cần remote worker, phải dùng một agent outbound chạy trên máy local, xác thực bằng token ngắn hạn, chỉ poll/forward các endpoint ComfyUI cần thiết và không nhận shell command tùy ý. Contract hiện tại nằm tại `docs/comfyui-local-agent.md`; repo **chưa** triển khai relay cloud hoàn chỉnh, nên không tuyên bố Cloud đã điều khiển được ComfyUI local.

## Google AI Studio Build

Sau khi repository có trên GitHub:

1. Mở https://aistudio.google.com/apps.
2. Chọn **Build**.
3. Chọn **Import from GitHub** và kết nối GitHub nếu được yêu cầu.
4. Chọn `phatptgaming/-biren-social-studio`.
5. Kiểm tra Preview và khai báo biến môi trường/secret trên nền tảng nếu dùng Gemini hoặc Meta.
6. Có thể bật GitHub Sync trong Settings/GitHub; tránh sửa cùng một file đồng thời tại AI Studio và local.

Lưu ý cho Cloud:

- Đặt `FRONTEND_URL` và `APP_BASE_URL` đúng domain public để OAuth callback quay về đúng ứng dụng.
- `127.0.0.1:8188` trên Cloud là máy của Cloud, không phải máy cá nhân. ComfyUI local cần Local mode hoặc Local Agent theo contract ở trên.
- SQLite và thư mục `.data` có thể không bền vững khi redeploy; cần thay bằng storage/database của nền tảng nếu dùng production.
- Không đưa API Key, App Secret hoặc token vào source, README hoặc biến public.

Không coi đây là xác nhận đã import thành công nếu chưa thực hiện xác minh trên tài khoản Google AI Studio.

## Phạm vi phiên bản đầu

Đã tập trung vào tạo nội dung, ảnh, preview, Facebook Fanpage và lịch sử. Chưa bao gồm multi-user, thanh toán, analytics nâng cao, Instagram, TikTok, chatbot hoặc relay cloud cho Local Agent.

Nhà phát triển: **BirenDev**.
