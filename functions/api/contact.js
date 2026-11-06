
const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store"
    }
  });

export async function onRequestPost({ request, env }) {
  try {
    if (!env.RESEND_API_KEY) {
      return json({ ok: false, error: "Server configuration error" }, 500);
    }

    const origin = request.headers.get("Origin");
    if (origin && new URL(origin).hostname !== "guneo.net") {
      return json({ ok: false, error: "Invalid origin" }, 403);
    }

    const contentType = request.headers.get("Content-Type") || "";
    if (!contentType.includes("application/json")) {
      return json({ ok: false, error: "Invalid content type" }, 415);
    }

    const { name, email, message, website } = await request.json();

    // 迷惑送信対策用の隠し項目
    if (website) {
      return json({ ok: true });
    }

    if (
      typeof name !== "string" ||
      typeof email !== "string" ||
      typeof message !== "string"
    ) {
      return json({ ok: false, error: "Invalid input" }, 400);
    }

    const cleanName = name.trim();
    const cleanEmail = email.trim();
    const cleanMessage = message.trim();

    if (
      !cleanName || cleanName.length > 100 ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail) ||
      cleanEmail.length > 254 ||
      !cleanMessage || cleanMessage.length > 5000
    ) {
      return json({ ok: false, error: "Invalid input" }, 400);
    }

    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        from: "#GUNEO Contact <noreply@guneo.net>",
        to: ["contact@guneo.net"],
        reply_to: cleanEmail,
        subject: `【#GUNEO】お問い合わせ: ${cleanName.replace(/[\r\n]/g, " ")}`,
        text: [
          "公式サイトからお問い合わせが届きました。",
          "",
          `お名前: ${cleanName}`,
          `メールアドレス: ${cleanEmail}`,
          "",
          "お問い合わせ内容:",
          cleanMessage
        ].join("\n")
      })
    });

    if (!response.ok) {
      console.error("Resend error:", response.status);
      return json({ ok: false, error: "Mail delivery failed" }, 502);
    }

    return json({ ok: true });
  } catch (error) {
    console.error("Contact form error:", error);
    return json({ ok: false, error: "Server error" }, 500);
  }
}

export async function onRequestGet() {
  return json({ ok: false, error: "Method not allowed" }, 405);
}
