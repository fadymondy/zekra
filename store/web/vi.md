<!-- Machine-assisted translation (2026-10-14), awaiting native-speaker review. Terms: lang/glossary.md -->

---
locale: vi
title: "Zekra — Bộ nhớ dài hạn cho AI agent qua MCP"
description: "Một cơ quan trí nhớ cho AI agent. Gợi nhớ dài hạn và đồ thị thực thể mà agent nào cũng truy cập được qua MCP — để điều một phiên học được, phiên sau đã biết sẵn."
source: web/content/site/landing.en.json
---

# Zekra

_BỘ NHỚ CHO AI AGENT · QUA MCP_

Một cơ quan trí nhớ cho AI agent. Gợi nhớ dài hạn và đồ thị thực thể mà agent nào cũng truy cập được qua MCP — để điều một phiên học được, phiên sau đã biết sẵn.

[Mở ứng dụng](https://app.zekra.dev) · [Đọc tài liệu](@docs)

- MCP từ xa tại mcp.zekra.dev
- Đăng nhập OAuth cho Claude.ai và ChatGPT
- Postgres · VectorChord · BM25
- Ghi chú bạn và agent dùng chung
- Một CLI cho Claude Code, Codex, Gemini, Cursor
- Bảng điều khiển tại app.zekra.dev

## Tính năng

### Gợi nhớ kết hợp, không chỉ vector

Độ tương đồng vector và BM25 được hợp nhất bằng reciprocal rank, rồi xếp hạng lại. Một cái tên hay một cụm từ chính xác sẽ được tìm thấy bởi nửa tìm kiếm giỏi về tên.

### Nóng và lạnh, như một bộ não

Tầng nóng kiểu hippocampus trả lời nhanh; tầng lạnh kiểu vỏ não giữ lại mọi thứ. Quá trình củng cố theo mức quan trọng chuyển điều đáng nhớ giữa hai tầng khi bạn không để ý.

### Củng cố lại khi gợi nhớ

Nhớ lại một điều sẽ làm nó thay đổi — gợi nhớ làm ký ức vững hơn và cho phép chỉnh sửa, thay vì để một dữ kiện lỗi thời bị truy xuất mãi.

### Client nào cũng được, một giao thức

Claude Code và Desktop, Codex, Gemini CLI và Cursor kết nối qua CLI zekra. Claude.ai và ChatGPT kết nối tới máy chủ từ xa tại mcp.zekra.dev và đăng nhập bằng OAuth — không cần cài bản chạy cục bộ.

### Mỗi ký ức là một ghi chú

Những gì agent ghi nhớ là một ghi chú để bạn đọc, gắn thẻ, liên kết và sửa trong bảng điều khiển — và mỗi ghi chú là một nút trong đồ thị thực thể của bộ não.

### Bộ não có phạm vi và két bảo mật

Mỗi bộ não được cấp quyền theo từng agent và từng người, với token có phạm vi. Thông tin đăng nhập dán vào ký ức sẽ được chuyển vào két bảo mật mã hóa thay vì lưu dưới dạng văn bản.

## Biến điều đội ngũ của bạn biết thành bộ slide, báo cáo và trang — tiếng Ả Rập và tiếng Anh

_DÀNH CHO ĐỘI NGŨ CỦA BẠN_

Ký ức mà agent xây nên cũng là của đội ngũ bạn. Bản trình bày Zekra bắt đầu từ một ghi chú, một truy vấn gợi nhớ hoặc cả bộ não, rồi soạn bộ slide, báo cáo hay trang đích sẵn sàng gửi khách hàng từ những gì bộ não thực sự có.

### Từ ghi chú và bộ não

Chọn ghi chú, một truy vấn hoặc một bộ não; bản nháp được dựng từ những ký ức đó, không phải từ trang trống.

### Bộ slide, báo cáo hoặc trang

Một nguồn, ba dạng: slide để trình bày, báo cáo để gửi, trang để xuất bản.

### Tiếng Ả Rập và tiếng Anh

Tiếng Ả Rập viết từ phải sang trái được bố cục đúng cách, không phải lật ngược cho có.

### PDF và Word

Xuất bộ slide hoặc báo cáo ra PDF hoặc tài liệu Word có thể chỉnh sửa.

### Liên kết chia sẻ riêng tư

Chia sẻ với khách hàng bằng liên kết; liên kết là chìa khóa duy nhất, và bạn có thể thu hồi nó.

### Thuộc về bộ não

Bản trình bày nằm cùng bộ não tạo ra chúng, với cùng quyền truy cập.

## Bắt đầu

1. Cài đặt CLI

   `curl -fsSL https://app.zekra.dev/install.sh | sh`

2. Đăng nhập bằng token từ bảng điều khiển

   `zekra auth login --token cbt_...`

3. Kết nối Zekra với client của bạn

   `zekra mcp:install claude-code --brain my-project`

4. Hoặc thêm vào Claude.ai hay ChatGPT

   `https://mcp.zekra.dev`

## Vì sao chọn Zekra?

Bốn cách để một agent biết điều gì đó, từ ngắn hạn nhất đến dài hạn nhất.

## Trạng thái

Đang hoạt động. Bảng điều khiển chạy tại app.zekra.dev và máy chủ MCP từ xa tại mcp.zekra.dev, trên Postgres với VectorChord và BM25, nhúng và xếp hạng lại qua TEI — ghi nhớ, gợi nhớ, ghi chú và đồ thị thực thể đang được dùng hằng ngày.

## Cho agent của bạn một bộ nhớ.

Mở bảng điều khiển để tạo bộ não, tạo token có phạm vi và kết nối Claude Code, Cursor, Claude.ai, ChatGPT hoặc bất kỳ ứng dụng MCP nào.

[Mở ứng dụng](https://app.zekra.dev) · [Gắn sao trên GitHub](https://github.com/fadymondy/zekra)
