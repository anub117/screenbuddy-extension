// Create buddy container
const buddyContainer = document.createElement("div");
buddyContainer.style.position = "fixed";
buddyContainer.style.bottom = "20px";
buddyContainer.style.right = "20px";
buddyContainer.style.zIndex = "999999";
buddyContainer.style.display = "flex";
buddyContainer.style.alignItems = "flex-end";
buddyContainer.style.fontFamily = "system-ui, -apple-system, sans-serif";
buddyContainer.style.pointerEvents = "none";

// Speech Bubble
const bubble = document.createElement("div");
bubble.style.background = "#ffffff";
bubble.style.color = "#333333";
bubble.style.padding = "10px 14px";
bubble.style.borderRadius = "14px 14px 0 14px";
bubble.style.boxShadow = "0 8px 20px rgba(0,0,0,0.1)";
bubble.style.marginRight = "14px";
bubble.style.marginBottom = "6px";
bubble.style.fontSize = "13px";
bubble.style.lineHeight = "1.4";
bubble.style.opacity = "0";
bubble.style.transform = "translateY(10px)";
bubble.style.transition = "all 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275)";
bubble.style.pointerEvents = "auto";
bubble.style.backdropFilter = "blur(10px)";
buddyContainer.appendChild(bubble);

// Buddy Circle
const buddy = document.createElement("div");
buddy.style.width = "18px";
buddy.style.height = "18px";
buddy.style.borderRadius = "50%";
buddy.style.background = "linear-gradient(135deg, #18dcff, #7efff5)";
buddy.style.boxShadow = "0 0 12px rgba(24, 220, 255, 0.5)";
buddy.style.transition = "all 0.3s ease";
buddy.style.pointerEvents = "auto";
buddy.style.cursor = "pointer";

buddyContainer.appendChild(buddy);
document.body.appendChild(buddyContainer);

// Subtle hover effect
buddy.addEventListener("mouseenter", () => {
  buddy.style.transform = "scale(1.3)";
  buddy.style.boxShadow = "0 0 20px rgba(24, 220, 255, 0.8)";
});

buddy.addEventListener("mouseleave", () => {
  buddy.style.transform = "scale(1)";
  buddy.style.boxShadow = "0 0 12px rgba(24, 220, 255, 0.5)";
});

let hideTimeout = null;

function showMessage(msg) {
  bubble.innerText = msg;
  bubble.style.opacity = "1";
  bubble.style.transform = "translateY(0)";
  
  if (hideTimeout) clearTimeout(hideTimeout);
  
  hideTimeout = setTimeout(() => {
    bubble.style.opacity = "0";
    bubble.style.transform = "translateY(10px)";
  }, 10000); // hide after 10s
}

// Listen for messages from background script
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.cmd === "smart-nudge") {
    showMessage("You've been here for a while. How about a stretch? 😊");
  }
});