import React, { useEffect } from "react";

const Toast = ({ message, type = "info", onClose, duration = 3000 }) => {
  useEffect(() => {
    if (!message) return;
    const timer = setTimeout(() => {
      onClose();
    }, duration);
    return () => clearTimeout(timer);
  }, [message, duration, onClose]);

  if (!message) return null;

  const backgroundColor =
    type === "error" ? "#d32f2f" : type === "success" ? "#2e7d32" : "#323232";

  return (
    <div
      role="alert"
      style={{
        position: "fixed",
        top: "20px",
        right: "20px",
        zIndex: 3000,
        background: backgroundColor,
        color: "#fff",
        padding: "14px 20px",
        borderRadius: "8px",
        boxShadow: "0 4px 12px rgba(0,0,0,0.25)",
        display: "flex",
        alignItems: "center",
        gap: "12px",
        minWidth: "260px",
        maxWidth: "400px",
        fontSize: "0.95rem",
        animation: "fadeInToast 0.25s ease-out",
      }}
    >
      <span style={{ flex: 1 }}>{message}</span>
      <button
        onClick={onClose}
        aria-label="Close notification"
        style={{
          background: "none",
          border: "none",
          color: "#fff",
          fontSize: "1.1rem",
          cursor: "pointer",
          lineHeight: 1,
        }}
      >
        ×
      </button>
    </div>
  );
};

export default Toast;