# Biren Social Studio

Biren Social Studio là web app tiếng Việt hỗ trợ tạo nội dung bán hàng, quản lý ảnh sản phẩm, xem trước và đăng bài lên Facebook Fanpage.

> **Trạng thái bàn giao:** mã nguồn đã triển khai đầy đủ luồng local và các adapter tích hợp thật cho Gemini, ComfyUI và Meta Graph API. Việc gọi dịch vụ bên ngoài chỉ hoạt động sau khi chủ dự án cấu hình credential/workflow tương ứng; ứng dụng không giả lập kết nối thành công.

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

## Cấu hình môi trường

Không commit `.env`. Hãy sao chép `.env.example` thành `.env` rồi điền các giá trị cần thiết.

### Gemini

Có thể cấu hình trong màn hình **Cài đặt** hoặc bằng biến môi trường:

```env
GEMINI_API_KEY=your-key
GEMINI_MODEL=gemini-2.5-flash
```

API Key nhập qua giao diện được mã hóa AES-256-GCM và lưu trong SQLite local. Khóa mã hóa được lấy từ `APP_ENCRYPTION_KEY`; nếu không có, ứng dụng tự tạo khóa cục bộ trong `.data/.secret-key` (file này bị Git ignore). Không lưu khóa ở localStorage.

Model là cấu hình mở, có thể đổi sang model Gemini đang được tài khoản hỗ trợ.

### ComfyUI

1. Chạy ComfyUI local, mặc định tại `http://127.0.0.1:8188`.
2. Xuất workflow API JSON từ ComfyUI.
3. Vào **Cài đặt → ComfyUI**, nhập URL và workflow JSON.
4. Trong workflow, dùng chuỗi `__INPUT_IMAGE__` tại node cần tên ảnh đầu vào.
5. Bấm kiểm tra kết nối trước khi dùng xử lý ảnh.

Ứng dụng sẽ upload ảnh lên ComfyUI, gửi prompt, chờ history hoàn tất và tải ảnh kết quả về local. Nếu ComfyUI hoặc workflow không hoạt động, nút làm đẹp bị khóa và chế độ giữ ảnh gốc vẫn dùng được.

> Khi chạy trên Cloud, `127.0.0.1` là máy Cloud chứ không phải máy cá nhân. Không được công khai ComfyUI ra Internet chỉ để vượt giới hạn này; hãy dùng một adapter/network riêng nếu cần triển khai Cloud.

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

4. Cấp các quyền tối thiểu cần cho luồng này: `pages_show_list`, `pages_read_engagement` và `pages_manage_posts`.
5. Vào **Kết nối dịch vụ → Kết nối Facebook**, hoàn thành OAuth và chọn Fanpage trong trình tạo bài.

App Secret và Page Access Token chỉ nằm ở backend; token được mã hóa trong SQLite và không trả về frontend/log. OAuth có `state` ngẫu nhiên và được kiểm tra khi callback. Nếu token hết hạn hoặc quyền bị thu hồi, ứng dụng báo lỗi và yêu cầu kết nối lại.

Meta có thể yêu cầu App Review hoặc tài khoản/role phù hợp trước khi quyền hoạt động trong production. Ứng dụng không tuyên bố hỗ trợ đăng Facebook cá nhân.


## Luồng sử dụng

1. **Tạo bài đăng:** nhập thông tin sản phẩm, hoặc dùng Gemini để tạo nội dung.
2. Chỉnh sửa nội dung, viết lại, rút gọn hoặc tạo phiên bản khác.
3. Tải ảnh JPG/PNG/WebP tối đa 10 MB. Ảnh gốc luôn được giữ lại.
4. Chọn giữ ảnh gốc hoặc xử lý qua workflow ComfyUI thành công.
5. Chọn Fanpage và xem preview.
6. Bấm đăng, xác nhận trong hộp thoại lần cuối.
7. Backend gọi Page Photos API nếu có ảnh, hoặc Page Feed API nếu không có ảnh, rồi lưu lịch sử thành công/thất bại.

Không có retry tự động khi đăng lỗi để tránh đăng trùng.

## API chính

- `GET /api/health`
- `GET /api/status`
- `POST /api/content/generate`
- `POST /api/media/upload`
- `POST /api/media/:fileName/process`
- `GET /api/facebook/oauth/start`
- `GET /api/facebook/oauth/callback`
- `GET /api/facebook/pages`
- `POST /api/posts/publish`
- `GET /api/posts`
- `DELETE /api/posts/:id`

## Dữ liệu và bảo mật

- `.env`, database, khóa cục bộ, upload và `dist` đều bị `.gitignore`.
- Upload giới hạn loại ảnh và 10 MB; tên file được sinh server-side và kiểm tra path traversal.
- Backend validate nội dung, Fanpage và tên file trước khi thao tác.
- Frontend không tự quyết định quyền Facebook và không nhận App Secret/Page Token.
- SQLite local nằm trong `.data/`. Khi triển khai Cloud, filesystem/SQLite có thể mất khi redeploy; nên thay lớp lưu trữ bằng database/secret storage bền vững của nền tảng trước khi dùng production.
- Ảnh người dùng không nằm trong repository.

## Kiểm tra phát triển

```powershell
npm run typecheck
npm run build
```

Smoke test local sau khi khởi động server:

```powershell
Invoke-RestMethod http://localhost:3001/api/health
Invoke-RestMethod http://localhost:3001/api/status
```

Khi chưa cấu hình Gemini, ComfyUI hoặc Meta, các endpoint vẫn trả trạng thái rõ ràng và ứng dụng vẫn chạy được ở chế độ viết/chọn ảnh thủ công; không được xem đó là kiểm chứng tài khoản thật.

## Google AI Studio Build

Sau khi repository có trên GitHub:

1. Mở https://aistudio.google.com/apps.
2. Chọn **Build**.
3. Chọn **Import from GitHub** và kết nối GitHub nếu được yêu cầu.
4. Chọn `phatptgaming/biren-social-studio`.
5. Kiểm tra Preview và khai báo biến môi trường/secret trên nền tảng nếu dùng Gemini hoặc Meta.
6. Có thể bật GitHub Sync trong Settings/GitHub; tránh sửa cùng một file đồng thời tại AI Studio và local.

Không coi đây là xác nhận đã import thành công nếu chưa thực hiện xác minh trên tài khoản Google AI Studio.

## Phạm vi phiên bản đầu

Đã tập trung vào tạo nội dung, ảnh, preview, Facebook Fanpage và lịch sử. Chưa bao gồm multi-user, thanh toán, analytics nâng cao, Instagram, TikTok hoặc chatbot.

## Phát triển

```powershell
npm run dev
npm run check
```

Nhà phát triển: **BirenDev**.
