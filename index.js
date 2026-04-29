console.log("[CCStats] Script source file loaded.");
window.ccs_loaded = true;
import { getContext } from "../../../extensions.js";
import { getPastCharacterChats, getRequestHeaders } from '../../../../script.js';

const extensionName = "chat-companion-stats";
const extensionWebPath = import.meta.url.replace(/\/index\.js$/, '');
const DEBUG = true;

jQuery(async () => {
  if (DEBUG) console.log("[CCStats] Booting...");
  // 加载CSS文件 using dynamic path
  $('head').append(`<link rel="stylesheet" type="text/css" href="${extensionWebPath}/styles.css">`);

  // 加载自定义字体 (Added handwritten and PING FANG SHAO HUA font)
  $('head').append(`<style>
    @import url("https://fontsapi.zeoseven.com/19/main/result.css");
    @import url("https://fontsapi.zeoseven.com/157/main/result.css");
    @import url("https://fontsapi.zeoseven.com/101/main/result.css");
    @import url("https://fonts.googleapis.com/css2?family=Long+Cang&display=swap");
    
    #ccs-preview-container.loading-preview {
      position: relative;
      min-height: 200px;
    }
    #ccs-preview-container.loading-preview::before {
      content: "";
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background: rgba(255, 255, 255, 0.5);
      backdrop-filter: blur(2px);
      border-radius: 5px;
      z-index: 9;
    }
    #ccs-preview-container.loading-preview::after {
      content: "";
      position: absolute;
      top: 50%;
      left: 50%;
      width: 48px;
      height: 48px;
      margin-top: -24px;
      margin-left: -24px;
      border: 3px solid transparent;
      border-top-color: #4fa3d1; /* Darker blue */
      border-bottom-color: #aed9e0; /* Light Blue */
      border-radius: 50%;
      animation: ccs-spin 1.2s cubic-bezier(0.5, 0, 0.5, 1) infinite;
      z-index: 10;
    }
    @keyframes ccs-spin {
      0% { transform: rotate(0deg); }
      100% { transform: rotate(360deg); }
    }
  </style>`);

  // 从 localStorage 加载上次选择的风格，默认为 'modern-light'
  let shareStyle = localStorage.getItem('ccs-share-style') || 'modern-light';
  let currentAdvancedStats = null;
  let lastDeepScanPartial = false; // 记录上次深度扫描是否有部分文件失败
  // 核心功能：全局缓存准确的初遇时间，避免在扫描模式间切换时发生横跳
  const accurateEncounterTimeCache = {};
  // 核心功能：全局缓存准确的字数/体积比，校准估算系统
  const accurateWordRatioCache = {};

  // 加载HTML using dynamic path with cache buster
  const settingsHtml = await $.get(`${extensionWebPath}/settings.html?v=${Date.now()}`);
  $("#extensions_settings").append(settingsHtml);
  if (DEBUG) console.log("[CCStats] UI Template loaded.");
  
  // Move modals to body to prevent clipping by parent containers and fix fixed positioning
  $("#ccs-preview-modal, #ccs-global-modal, #ccs-advanced-modal").appendTo("body").removeClass('ccs-modal-visible').hide();

  // 阻止事件冒泡，防止点击模态框时触发 ST 原生的“点击外部关闭扩展面板”逻辑
  // 增加 mousedown, mouseup, touchstart, touchend 确保全平台所有可能的触发事件都被拦截
  $("#ccs-preview-modal, #ccs-global-modal, #ccs-advanced-modal").on('pointerdown pointerup mousedown mouseup touchstart touchend click', function(e) {
    e.stopPropagation();
  });

  // 同步下拉框的选择状态
  $("#ccs-style-select").val(shareStyle);

  // 确保模态框初始状态是隐藏的
  $("#ccs-preview-modal").hide();

  function getCurrentCharacterName() {
    // 从聊天消息中获取非用户消息的 ch_name
    const messages = document.querySelectorAll('#chat .mes');
    for (const msg of messages) {
      const isUser = msg.getAttribute('is_user') === 'true';
      if (!isUser) {
        const chName = msg.getAttribute('ch_name');
        if (chName) return chName;
      }
    }

    // 备用方法：从选中的角色按钮获取
    const selectedChar = document.querySelector('#rm_button_selected_ch h2');
    if (selectedChar?.textContent) {
      return selectedChar.textContent.trim();
    }

    return "未知角色";
  }

  // Helper function to parse SillyTavern's date format more reliably
  // Use both full month names and 3-letter abbreviations
  const monthMap = {
    Jan: '01', January: '01',
    Feb: '02', February: '02',
    Mar: '03', March: '03',
    Apr: '04', April: '04',
    May: '05', May: '05',
    Jun: '06', June: '06',
    Jul: '07', July: '07',
    Aug: '08', August: '08',
    Sep: '09', September: '09',
    Oct: '10', October: '10',
    Nov: '11', November: '11',
    Dec: '12', December: '12'
  };

  function parseSillyTavernDate(dateString) {
    if (DEBUG) console.log(`Attempting to parse date: "${dateString}"`);
    if (!dateString) {
      if (DEBUG) console.log("Date string is empty, returning null.");
      return null;
    }

    // Try parsing the specific format "Month Day, Year HH:MMam/pm"
    const parts = dateString.match(/(\w+)\s+(\d+),\s+(\d+)\s+(\d+):(\d+)(am|pm)/i);
    if (DEBUG) console.log("Regex match result (parts):", parts);
    if (parts) {
      console.log("Regex matched specific format.");
      const monthName = parts[1];
      const day = parts[2];
      const year = parts[3];
      let hour = parseInt(parts[4], 10);
      const minute = parts[5];
      const ampm = parts[6].toLowerCase();
      if (DEBUG) console.log(`Parsed parts: Month=${monthName}, Day=${day}, Year=${year}, Hour=${hour}, Minute=${minute}, AMPM=${ampm}`);

      const monthNumber = monthMap[monthName];
      if (!monthNumber) {
        if (DEBUG) console.warn(`Unknown month name "${monthName}" in date string: ${dateString}`);
        return null;
      }
      if (DEBUG) console.log(`Month number: ${monthNumber}`);

      if (ampm === 'pm' && hour !== 12) {
        hour += 12;
        if (DEBUG) console.log(`Adjusted hour for PM: ${hour}`);
      } else if (ampm === 'am' && hour === 12) {
        hour = 0;
        if (DEBUG) console.log(`Adjusted hour for 12 AM: ${hour}`);
      }

      // Construct an ISO-like string that new Date() handles reliably
      const isoLikeString = `${year}-${monthNumber}-${day.padStart(2, '0')}T${String(hour).padStart(2, '0')}:${minute}:00`;
      if (DEBUG) console.log(`Constructed ISO-like string: ${isoLikeString}`);
      const date = new Date(isoLikeString);
      if (DEBUG) console.log(`Result of new Date(isoLikeString): ${date}`);
      const isValid = date && !isNaN(date.getTime());
      if (DEBUG) console.log(`Is parsed date valid? ${isValid}`);
      return isValid ? date : null;
    }

    if (DEBUG) console.log("Regex did not match specific format, trying fallback.");
    // Fallback: Try direct parsing for other potential formats
    const fallbackDate = new Date(dateString);
    if (DEBUG) console.log(`Result of fallback new Date(dateString): ${fallbackDate}`);
    const isFallbackValid = fallbackDate && !isNaN(fallbackDate.getTime());
    if (DEBUG) console.log(`Is fallback date valid? ${isFallbackValid}`);
    return isFallbackValid ? fallbackDate : null;
  }

  // 从文件名解析时间
  function parseTimeFromFilename(filename) {
    // 从文件名中提取日期和时间
    const match = filename.match(/(\d{4}-\d{2}-\d{2})@(\d{2})h(\d{2})m(\d{2})s/);
    if (match) {
      const [_, date, hours, minutes, seconds] = match;
      const totalSeconds = parseInt(hours, 10) * 3600 + parseInt(minutes, 10) * 60 + parseInt(seconds, 10);

      // 构建日期对象 (注意：Date.parse 也支持 YYYY-MM-DDTHH:mm:ss 格式)
      const dateObject = new Date(`${date}T${hours}:${minutes}:${seconds}`);

      return {
        date,
        time: `${hours}:${minutes}:${seconds}`,
        fullDateTime: `${date} ${hours}:${minutes}:${seconds}`,
        totalSeconds,
        dateObject: !isNaN(dateObject.getTime()) ? dateObject : null
      };
    }
    return null;
  }

  // 格式化日期时间
  function formatDateTime(dateTimeString) {
    if (!dateTimeString) return "未知时间";
    const date = new Date(dateTimeString);
    if (isNaN(date.getTime())) return "未知时间";

    const year = date.getFullYear();
    const month = date.getMonth() + 1;
    const day = date.getDate();
    const hours = date.getHours();
    const minutes = date.getMinutes();

    return `${year}年${month}月${day}日 ${hours}点${minutes}分`;
  }

  // 格式化时长
  function formatDuration(totalSeconds) {
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    if (hours > 0) {
      return `${hours}小时${minutes}分钟`;
    } else if (minutes > 0) {
      return `${minutes}分钟${seconds}秒`;
    } else {
      return `${seconds}秒`;
    }
  }

  // 尝试获取当前用户标识 (已不再强制需要，API 可自动处理)
  function getUserHandle() {
    const context = getContext();
    // 1. 尝试从 context 直接获取
    if (context.user_handle) return context.user_handle;

    // 2. 尝试从头像 URL 提取
    const messages = document.querySelectorAll('#chat .mes');
    for (const msg of messages) {
       if (msg.getAttribute('is_user') !== 'true') {
         const avatarImg = msg.querySelector('.avatar img');
         if (avatarImg && avatarImg.src) {
           const src = avatarImg.src;
           // 匹配格式: /characters/user_handle/name.png
           const match = src.match(/\/characters\/([^\/]+)\//);
           if (match && match[1] !== 'characters') return match[1];
         }
       }
    }
    return null;
  }
  function countWordsInMessage(message) {
    if (!message) return 0;

    let text = message;

    // 1. 深度正则过滤 (使用制作人排除法)
    try {
      // - 排除 think/thinking 块 (处理已完成和未完成的)
      text = text.replace(/<(think|thinking)>[\s\S]*?(<\/\1>|$)/gi, '');

      // - 排除元数据标签及其中间内容
      text = text.replace(/\[finire\]/gi, '');
      text = text.replace(/<(finish|disclaimer)>[\s\S]*?(<\/\1>|$)/gi, '');

      // - 排除 HTML 注释 (包括 draft/confirm)
      text = text.replace(/<!--[\s\S]*?-->/g, '');

      // - 排除特定的系统/UI标签如 <DH_...>, <FH_...>
      text = text.replace(/<(DH|FH)_[^>]*>/gi, '');

      // - 排除特定的样式标记 (处理可能的兼容性)
      text = text.replace(/<p style[^>]*>/gi, '');
    } catch (reError) {
      if (DEBUG) console.warn('Regex filtering failed for a message:', reError);
    }

    // - 移除所有剩余的 HTML 标签
    text = text.replace(/<[^>]*>/g, '');

    // 2. 统计处理
    // 中/日/韩文字符
    const cjkChars = text.match(/[\u4e00-\u9fff\u3040-\u30ff\u31f0-\u31ff\uac00-\ud7af]/g) || [];
    // 英文单词/拉丁单词
    const latinWords = text.match(/[a-zA-Z0-9]+/g) || [];

    return cjkChars.length + latinWords.length;
  }

  // 获取当前聊天的字数统计和大小
  function getCurrentChatStats() {
    const messages = document.querySelectorAll('#chat .mes');
    let userWords = 0, userSize = 0, userCount = 0;
    let charWords = 0, charSize = 0, charCount = 0;
    let userChineseRatio = 0, userEnglishRatio = 0;
    let charChineseRatio = 0, charEnglishRatio = 0;

    messages.forEach(message => {
      const content = message.querySelector('.mes_text')?.textContent || '';
      const isUser = message.getAttribute('is_user') === 'true';
      const words = countWordsInMessage(content);

      // 计算中英文比例
      const chineseChars = content.match(/[\u4e00-\u9fff]/g) || [];
      const englishWords = content.match(/[a-zA-Z0-9]+/g) || [];
      const totalChars = chineseChars.length + englishWords.length;

      if (totalChars > 0) {
        const chineseRatio = chineseChars.length / totalChars;
        const englishRatio = englishWords.length / totalChars;

        if (isUser) {
          userChineseRatio += chineseRatio;
          userEnglishRatio += englishRatio;
        } else {
          charChineseRatio += chineseRatio;
          charEnglishRatio += englishRatio;
        }
      }

      const messageData = {
        content,
        is_user: isUser,
        ch_name: message.getAttribute('ch_name') || '',
        send_date: message.getAttribute('send_date') || ''
      };
      const messageSize = JSON.stringify(messageData).length + 2; // 加换行

      if (isUser) {
        userWords += words;
        userSize += messageSize;
        userCount++;
      } else {
        charWords += words;
        charSize += messageSize;
        charCount++;
      }
    });

    // 计算平均中英文比例
    if (userCount > 0) {
      userChineseRatio /= userCount;
      userEnglishRatio /= userCount;
    }
    if (charCount > 0) {
      charChineseRatio /= charCount;
      charEnglishRatio /= charCount;
    }

    return {
      user: {
        words: userWords,
        size: userSize,
        count: userCount,
        chineseRatio: userChineseRatio,
        englishRatio: userEnglishRatio
      },
      char: {
        words: charWords,
        size: charSize,
        count: charCount,
        chineseRatio: charChineseRatio,
        englishRatio: charEnglishRatio
      }
    };
  }

  // 带超时和重试的 fetch 封装
  async function fetchWithTimeout(url, options = {}, timeoutMs = 30000) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, { ...options, signal: controller.signal });
      clearTimeout(timeoutId);
      return response;
    } catch (e) {
      clearTimeout(timeoutId);
      throw e;
    }
  }

  async function fetchWithRetry(url, options = {}, retries = 1, timeoutMs = 30000) {
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        return await fetchWithTimeout(url, options, timeoutMs);
      } catch (e) {
        if (attempt < retries) {
          if (DEBUG) console.log(`[StatsDebug] Fetch attempt ${attempt + 1} failed, retrying...`);
          await new Promise(r => setTimeout(r, 500)); // 短暂等待后重试
        } else {
          throw e;
        }
      }
    }
  }

  // 构建针对特定路径的 fetch 请求
  async function fetchChatFile(path) {
    try {
      if (DEBUG) console.log(`Attempting fetch: ${path}`);
      const response = await fetchWithTimeout(path, { credentials: 'same-origin' });
      if (response.ok) {
        return await response.text();
      }
      if (DEBUG) console.warn(`Fetch failed for ${path}: ${response.status}`);
    } catch (e) {
      if (DEBUG) console.error(`Fetch error for ${path}:`, e);
    }
    return null;
  }

  // 获取特定文件的第一条消息时间 (轻量版API调用)
  async function getEarliestMessageDate(fileName, charId, charName) {
    try {
      // API 要求不带扩展名的文件名（与 getChatFileStats 一致）
      let cleanFileName = fileName;
      if (cleanFileName.endsWith('.jsonl')) {
        cleanFileName = cleanFileName.replace('.jsonl', '');
      } else if (cleanFileName.endsWith('.json')) {
        cleanFileName = cleanFileName.replace('.json', '');
      }

      if (DEBUG) console.log(`[StatsDebug] getEarliestMessageDate: requesting "${cleanFileName}" for char: ${charName}`);

      const response = await fetchWithRetry('/api/chats/get', {
        method: 'POST',
        headers: Object.assign({ 'Content-Type': 'application/json' }, typeof getRequestHeaders === 'function' ? getRequestHeaders() : {}),
        body: JSON.stringify({
          ch_name: charName,
          avatar_url: charId,
          file_name: cleanFileName
        })
      }, 1, 30000);

      if (!response.ok) {
        if (DEBUG) console.warn(`[StatsDebug] getEarliestMessageDate: API returned ${response.status} for "${cleanFileName}"`);
        return null;
      }

      const chatData = await response.json();

      // 兼容多种返回格式（与 getChatFileStats 一致的解析逻辑）
      let messagesArray = [];
      if (Array.isArray(chatData)) {
        messagesArray = chatData;
      } else if (chatData && typeof chatData === 'object') {
        if (Array.isArray(chatData.chat)) {
          messagesArray = chatData.chat;
        } else if (Array.isArray(chatData.messages)) {
          messagesArray = chatData.messages;
        } else {
          messagesArray = Object.values(chatData).filter(item => item && typeof item === 'object' && (item.mes !== undefined || item.is_user !== undefined));
        }
      }

      if (DEBUG) console.log(`[StatsDebug] getEarliestMessageDate: got ${messagesArray.length} messages from "${cleanFileName}"`);

      // 遍历所有消息找到最早的日期
      let earliestDate = null;
      for (const m of messagesArray) {
        if (m && m.send_date) {
          const date = parseSillyTavernDate(m.send_date);
          if (date && (!earliestDate || date < earliestDate)) {
            earliestDate = date;
          }
        }
      }

      if (DEBUG && earliestDate) console.log(`[StatsDebug] getEarliestMessageDate: found date ${earliestDate.toISOString()} in "${cleanFileName}"`);
      return earliestDate;
    } catch (e) {
      if (DEBUG) console.error(`[StatsDebug] Error in getEarliestMessageDate for "${fileName}":`, e);
    }
    return null;
  }

  // 获取单个聊天文件的统计数据 (使用 SillyTavern 官方 API 接口)
  async function getChatFileStats(fileName, charId, charName) {
    if (DEBUG) console.log(`[StatsDebug] Requesting chat content via API: ${fileName} for char: ${charId}, name: ${charName}`);
    
    let chatData = null;
    try {
      // API expects the filename without the .jsonl extension
      let cleanFileName = fileName;
      if (cleanFileName.endsWith('.jsonl')) {
        cleanFileName = cleanFileName.replace('.jsonl', '');
      } else if (cleanFileName.endsWith('.json')) {
        cleanFileName = cleanFileName.replace('.json', '');
      }

      // 使用官方 API 获取聊天内容，必须包含 ch_name
      const response = await fetchWithRetry('/api/chats/get', {
        method: 'POST',
        headers: Object.assign({ 'Content-Type': 'application/json' }, typeof getRequestHeaders === 'function' ? getRequestHeaders() : {}),
        body: JSON.stringify({
          ch_name: charName,
          avatar_url: charId, // 备用标识
          file_name: cleanFileName
        })
      }, 1, 30000);

      if (DEBUG) console.log(`[StatsDebug] API Response Status: ${response.status}`);
      
      if (response.ok) {
        chatData = await response.json();
      }
    } catch (e) {
      if (DEBUG) console.error(`[StatsDebug] API fetch error:`, e);
    }

    // 兼容层：SillyTavern 的 /api/chats/get 返回格式可能是一个 Object 包含一个数组，或者就是一个字典
    let messagesArray = [];
    if (Array.isArray(chatData)) {
      messagesArray = chatData;
    } else if (chatData && typeof chatData === 'object') {
      // 如果不是纯数组，尝试在它的属性里找真正的聊天数据
      // 常见结构如 { chat: [...] } 或者对象属性直接是索引 {'0': {...}, '1': {...}}
      if (Array.isArray(chatData.chat)) {
        messagesArray = chatData.chat;
      } else if (Array.isArray(chatData.messages)) {
        messagesArray = chatData.messages;
      } else {
        // 尝试把类似字典的对象强行转成数组
        messagesArray = Object.values(chatData).filter(item => item && typeof item === 'object' && (item.mes !== undefined || item.is_user !== undefined));
      }
    }

    if (messagesArray.length === 0) {
      if (DEBUG) {
        console.warn(`[StatsDebug] Failed to retrieve or parse chat data for: ${fileName}`);
        let dataPreview = "null";
        try { if (chatData) dataPreview = JSON.stringify(chatData).substring(0, 300); } catch(e){}
        console.log(`[StatsDebug] Received Data type: ${typeof chatData}, Preview:`, dataPreview);
      }
      return { words: 0, count: 0, userCount: 0, earliestTime: null, dayMap: {} };
    }

    try {
      let totalWords = 0;
      let validMessages = 0;
      let userMessages = 0;
      let earliestTimeInFile = null;
      const dayMap = {};

      messagesArray.forEach(m => {
        if (m && (m.mes !== undefined || m.is_user !== undefined)) {
          totalWords += countWordsInMessage(m.mes || '');
          validMessages++;

          // 统计发送日期
          if (m.send_date) {
            const msgDate = parseSillyTavernDate(m.send_date);
            if (msgDate) {
              // 记录处理日期（用于 Streak/Peak）
              const dateKey = `${msgDate.getFullYear()}-${String(msgDate.getMonth() + 1).padStart(2, '0')}-${String(msgDate.getDate()).padStart(2, '0')}`;
              dayMap[dateKey] = (dayMap[dateKey] || 0) + 1;

              // 记录最早的用户时间
              if (m.is_user === true) {
                userMessages++;
              }
              // 不限制发言者是谁，记录绝对的最早消息发生时间
              if (!earliestTimeInFile || msgDate < earliestTimeInFile) {
                earliestTimeInFile = msgDate;
              }
            }
          }
        }
      });

      return {
        words: totalWords,
        count: validMessages,
        userCount: userMessages,
        earliestTime: earliestTimeInFile,
        dayMap
      };
    } catch (e) {
      if (DEBUG) console.error(`[StatsDebug] Error processing chat data:`, e);
      return { words: 0, count: 0, userCount: 0, earliestTime: null, dayMap: {} };
    }
  }

  // 从消息数据中获取统计信息
  function getStatsFromMessages(messages) {
    let userWords = 0, userSize = 0, userCount = 0;
    let charWords = 0, charSize = 0, charCount = 0;
    let userChineseRatio = 0, userEnglishRatio = 0;
    let charChineseRatio = 0, charEnglishRatio = 0;

    messages.forEach(message => {
      const content = message.mes || '';
      const isUser = message.is_user;
      const words = countWordsInMessage(content);

      // 计算中英文比例
      const chineseChars = content.match(/[\u4e00-\u9fff]/g) || [];
      const englishWords = content.match(/[a-zA-Z0-9]+/g) || [];
      const totalChars = chineseChars.length + englishWords.length;

      if (totalChars > 0) {
        const chineseRatio = chineseChars.length / totalChars;
        const englishRatio = englishWords.length / totalChars;

        if (isUser) {
          userChineseRatio += chineseRatio;
          userEnglishRatio += englishRatio;
        } else {
          charChineseRatio += chineseRatio;
          charEnglishRatio += englishRatio;
        }
      }

      const messageData = {
        content,
        is_user: isUser,
        ch_name: message.ch_name || '',
        send_date: message.send_date || ''
      };
      const messageSize = JSON.stringify(messageData).length + 2;

      if (isUser) {
        userWords += words;
        userSize += messageSize;
        userCount++;
      } else {
        charWords += words;
        charSize += messageSize;
        charCount++;
      }
    });

    // 计算平均中英文比例
    if (userCount > 0) {
      userChineseRatio /= userCount;
      userEnglishRatio /= userCount;
    }
    if (charCount > 0) {
      charChineseRatio /= charCount;
      charEnglishRatio /= charCount;
    }

    return {
      user: {
        words: userWords,
        size: userSize,
        count: userCount,
        chineseRatio: userChineseRatio,
        englishRatio: userEnglishRatio
      },
      char: {
        words: charWords,
        size: charSize,
        count: charCount,
        chineseRatio: charChineseRatio,
        englishRatio: charEnglishRatio
      }
    };
  }

  // 获取完整的统计数据
  async function getFullStats(forceDeepScan = false, onProgress = null) {
    const context = getContext();
    let characterId = context.characterId || context.character_id;

    if (DEBUG) {
      console.log(`[StatsDebug] getFullStats called (DeepScan=${forceDeepScan})`);
      console.log(`[StatsDebug] Context Debug:`, { 
        characterId, 
        selected: context.selected_character,
        charsCount: context.characters?.length,
        hasWindowChars: !!window.characters 
      });
    }

    if (!characterId) return null;

    try {
      // 1. 先尝试获取一次列表 (酒馆的 getPastCharacterChats 支持数字索引)
      const chats = await getPastCharacterChats(characterId);
      const chatFilesCount = Array.isArray(chats) ? chats.length : 0;

      // 2. 如果当前 ID 是数字，尝试修复为正确的 avatar 文件名
      if (!isNaN(characterId) || characterId === '0') {
         // 优先方案：通过 context 索引直接获取 avatar（最可靠，不受文件改名影响）
         const chars = context.characters || window.characters || [];
         // characterId 本身就是数字索引，当 selected_character 不可用时直接用它
         const idx = (context.selected_character !== undefined) ? context.selected_character 
                   : (window.selected_character !== undefined) ? window.selected_character 
                   : parseInt(characterId);
         if (chars && chars[idx] && chars[idx].avatar) {
            characterId = chars[idx].avatar;
            if (DEBUG) console.log(`[StatsDebug] ID upscaled via context avatar: ${characterId}`);
         } else if (chatFilesCount > 0 && chats[0].file_name) {
            // 后备方案：从文件名提取（仅当文件名包含标准 " - " 分隔符时才可靠）
            const parts = chats[0].file_name.split(' - ');
            if (parts.length >= 2) {
               characterId = `${parts[0]}.png`;
               if (DEBUG) console.log(`[StatsDebug] ID upscaled from filename: ${characterId}`);
            } else {
               if (DEBUG) console.warn(`[StatsDebug] Cannot upscale ID: file "${chats[0].file_name}" has no standard delimiter`);
            }
         }
      }

      let totalMessagesFromMetadata = 0;
      let totalSizeBytesRaw = 0;
      let earliestTime = null;
      let totalDurationSeconds = 0;
      let parseableFilesInfo = [];
      let unparseableFiles = [];
      let hasInteraction = false;

      if (chatFilesCount === 0) return { messageCount: 0, wordCount: 0, firstTime: null, totalDuration: 0, totalSizeBytes: 0, chatFilesCount: 0 };

      // 1. 快速计算基础数据 (基于 Metadata)
      chats.forEach(chat => {
        const itemsCount = parseInt(chat.chat_items) || 0;
        totalMessagesFromMetadata += itemsCount;
        
        let sizeBytes = 0;
        const sizeMatchKB = chat.file_size?.match(/([\d.]+)\s*KB/i);
        const sizeMatchMB = chat.file_size?.match(/([\d.]+)\s*MB/i);
        if (sizeMatchMB) sizeBytes = parseFloat(sizeMatchMB[1]) * 1024 * 1024;
        else if (sizeMatchKB) sizeBytes = parseFloat(sizeMatchKB[1]) * 1024;
        else sizeBytes = parseFloat(chat.file_size) || 0;
        
        totalSizeBytesRaw += sizeBytes;

        // 如果任何一个文件里的消息超过1条，或者没有明确记录条数但文件很大(>5KB)，认定发生了实质互动
        if (itemsCount > 1) {
          hasInteraction = true;
        } else if (itemsCount === 0 && sizeBytes > 5 * 1024) {
          hasInteraction = true;
        }

        if (chat.file_name) {
          const timeInfo = parseTimeFromFilename(chat.file_name);
          if (timeInfo && timeInfo.dateObject) {
            totalDurationSeconds += timeInfo.totalSeconds;
            parseableFilesInfo.push({ name: chat.file_name, date: timeInfo.dateObject });
            
            if (!earliestTime || timeInfo.dateObject < earliestTime) {
               earliestTime = timeInfo.dateObject;
            }
          } else {
            // 如果无法从名字解析出时间，作为存疑文件保留
            unparseableFiles.push(chat.file_name);
          }
        }
      });

      // 如果完全没有互动（所有的记录都只有开场白=1条，或者完全为空），强行阻断所有统计数据并清空UI
      if (!hasInteraction) {
        if (DEBUG) console.log("[StatsDebug] All files have 1 or fewer messages. Determined as 'Not Interacted'.");
        return { messageCount: 0, wordCount: 0, firstTime: null, totalDuration: 0, totalSizeBytes: 0, chatFilesCount };
      }

      // 获取当前的精准字数占比（如果有经过深度校准，则不再使用32.5的通用估值）
      let currentRatio = 32.5;
      if (accurateWordRatioCache[characterId]) {
          currentRatio = accurateWordRatioCache[characterId];
      }
      let estimatedWords = Math.round((totalSizeBytesRaw / 1024) * currentRatio);

      // 如果不是深度扫描，直接返回基础数据，但运用更为宽广的“精准打击”或读取锁定缓存
      if (!forceDeepScan) {
        if (accurateEncounterTimeCache[characterId]) {
           // 方案B：直接调用曾经找到的那个锁定好的绝对真理，防止被回退
           earliestTime = accurateEncounterTimeCache[characterId];
        } else {
           // 方案A：扩大打击范围，获取名义上最老的3个文件（完整统计）
           parseableFilesInfo.sort((a,b) => a.date - b.date);
           let filesToCheck = parseableFilesInfo.slice(0, 3).map(f => f.name);

           const charNameForApi = getCurrentCharacterName();
           if (filesToCheck.length > 0) {
              for (const file of filesToCheck) {
                 const fileStats = await getChatFileStats(file, characterId, charNameForApi);
                 if (fileStats && fileStats.earliestTime) {
                    if (!earliestTime || fileStats.earliestTime < earliestTime) {
                       earliestTime = fileStats.earliestTime;
                    }
                 }
              }
           }

           // 针对被用户改名的文件（无法从文件名解析日期的），使用轻量API逐一检查第一条消息的日期
           // 这里检查所有改名文件，因为真正的最早聊天可能就藏在其中
           if (unparseableFiles.length > 0) {
              if (DEBUG) console.log(`[StatsDebug] Found ${unparseableFiles.length} renamed/unparseable file(s), checking first message date for each...`);
              for (const file of unparseableFiles) {
                 const msgDate = await getEarliestMessageDate(file, characterId, charNameForApi);
                 if (msgDate) {
                    if (!earliestTime || msgDate < earliestTime) {
                       earliestTime = msgDate;
                       if (DEBUG) console.log(`[StatsDebug] Found earlier date from renamed file "${file}": ${msgDate.toISOString()}`);
                    }
                 }
              }
           }
           
           // 把首发找到的准确时间写入内存保险箱
           if (earliestTime) {
              accurateEncounterTimeCache[characterId] = earliestTime;
           }
        }

        return {
          messageCount: totalMessagesFromMetadata,
          wordCount: estimatedWords,
          firstTime: earliestTime,
          totalDuration: totalDurationSeconds,
          totalSizeBytes: totalSizeBytesRaw,
          chatFilesCount,
          advanced: null
        };
      }

      // 2. 深度扫描 (基于 API 读取文件)
      if (DEBUG) console.log(`[StatsDebug] Performing Deep Scan for ${chatFilesCount} files...`);
      
      const charNameForApi = getCurrentCharacterName();

      let totalWordsCalculated = 0;
      let totalMessagesCalculated = 0;
      let totalUserMessagesCalculated = 0;
      let absoluteEarliestTime = null;
      const globalDayMap = {};

      const batchSize = 3; // 降低并发数量保护服务器
      let processedFiles = 0;
      let failedFiles = 0;
      for (let i = 0; i < chats.length; i += batchSize) {
        const batch = chats.slice(i, i + batchSize);
        const results = await Promise.all(batch.map(chat => getChatFileStats(chat.file_name, characterId, charNameForApi)));

        processedFiles += batch.length;
        if (onProgress && chats.length > 0) {
          const percent = Math.min(100, Math.floor((processedFiles / chats.length) * 100));
          onProgress(percent, processedFiles, chats.length);
        }

        results.forEach(res => {
          if (res.count > 0 || res.words > 0) {
            totalWordsCalculated += res.words;
            totalMessagesCalculated += res.count;
            totalUserMessagesCalculated += (res.userCount || 0);
            if (res.dayMap) {
              for (const [date, count] of Object.entries(res.dayMap)) {
                globalDayMap[date] = (globalDayMap[date] || 0) + count;
              }
            }
            if (res.earliestTime && (!absoluteEarliestTime || res.earliestTime < absoluteEarliestTime)) {
              absoluteEarliestTime = res.earliestTime;
            }
          } else {
            failedFiles++;
          }
        });
      }

      if (DEBUG) console.log(`[StatsDebug] Deep scan done: ${processedFiles - failedFiles} succeeded, ${failedFiles} failed out of ${processedFiles}`);

      const advanced = calculateAdvancedStats(globalDayMap);
      
      // 深度扫描找出了贯穿所有聊天系统的绝对真理，霸道覆盖并永久锁定缓存！
      if (absoluteEarliestTime) {
          accurateEncounterTimeCache[characterId] = absoluteEarliestTime;
      }
      
      // 如果是一次完整的深度分析，记录这名角色专属的字数密度（字数 / 每KB体积）
      if (forceDeepScan && totalSizeBytesRaw > 0 && totalWordsCalculated > 0) {
          accurateWordRatioCache[characterId] = totalWordsCalculated / (totalSizeBytesRaw / 1024);
      }

      return {
        messageCount: totalMessagesCalculated || totalMessagesFromMetadata,
        wordCount: totalWordsCalculated || estimatedWords,
        firstTime: absoluteEarliestTime || earliestTime,
        totalDuration: totalDurationSeconds,
        totalSizeBytes: totalSizeBytesRaw,
        chatFilesCount,
        advanced,
        deepScanPartial: failedFiles > 0,
        deepScanFailed: failedFiles,
        deepScanTotal: processedFiles
      };
    } catch (error) {
      if (DEBUG) console.error('[StatsDebug] getFullStats error:', error);
      return null;
    }
  }

  // 计算连聊和高峰日
  function calculateAdvancedStats(dayMap) {
    const dates = Object.keys(dayMap).sort();
    if (dates.length === 0) return null;

    // 1. 高峰日
    let peakDate = dates[0];
    let peakCount = dayMap[peakDate];
    for (const date of dates) {
      if (dayMap[date] >= peakCount) { // 取最新的一天 (用 >=)
        peakDate = date;
        peakCount = dayMap[date];
      }
    }

    // 2. 连聊计算
    let longestStreak = 0;
    let currentStreak = 0;
    
    // 转换为时间戳进行连续性检查 (以天为单位)
    const dateObjects = dates.map(d => new Date(d + 'T00:00:00'));
    
    let tempStreak = 1;
    let lastDateObj = dateObjects[0];
    
    for (let i = 1; i < dateObjects.length; i++) {
      const diff = (dateObjects[i] - lastDateObj) / (1000 * 60 * 60 * 24);
      if (diff === 1) {
        tempStreak++;
      } else if (diff > 1) {
        longestStreak = Math.max(longestStreak, tempStreak);
        tempStreak = 1;
      }
      lastDateObj = dateObjects[i];
    }
    longestStreak = Math.max(longestStreak, tempStreak);

    // 计算今日对话条数
    const now = new Date();
    const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    const todayMessages = dayMap[todayStr] || 0;

    return {
      peakDate,
      peakCount,
      longestStreak,
      todayMessages
    };
  }



  // Debounce function
  function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
      const later = () => {
        clearTimeout(timeout);
        func(...args);
      };
      clearTimeout(timeout);
      timeout = setTimeout(later, wait);
    };
  }

  // 添加控制分享按钮状态的函数 (优先处理无互动状态)
  function updateActionButtonsState(messageCount) {
    const $shareButton = $("#ccs-share");
    const $viewMoreButton = $("#ccs-view-more");

    // Priority Check: Disable if total message count is 1 or less
    if (messageCount <= 1) {
      $shareButton.prop('disabled', true).val('尚未互动');
      $viewMoreButton.prop('disabled', true).val('尚未互动');
      if (DEBUG) console.log('updateActionButtonsState: Disabled (messageCount <= 1)');
      return;
    }

    $viewMoreButton.prop('disabled', false).val('查看更多');

    // If interaction exists (messageCount > 1), check if options are selected
    const anyOptionChecked = $('.ccs-share-option input[type="checkbox"]:checked').length > 0;

    if (anyOptionChecked) {
      $shareButton.prop('disabled', false).val('生成卡片');
      if (DEBUG) console.log('updateActionButtonsState: Enabled (options checked)');
    } else {
      $shareButton.prop('disabled', true).val('请选择内容');
      if (DEBUG) console.log('updateActionButtonsState: Disabled (no options checked)');
    }
  }

  // 添加控制提示显示的函数
  function updateTipVisibility(messageCount, chatFilesCount) {
    const $tip = $("#ccs-tip");
    if (messageCount <= 2 && chatFilesCount > 1) {
      $tip.show();
    } else {
      $tip.hide();
    }
  }

  async function updateStats(deepScan = false, onProgress = null) {
    if (DEBUG) console.log('Attempting to update stats...');
    const characterName = getCurrentCharacterName();
    $("#ccs-character").text(characterName);
    try {
      const stats = await getFullStats(deepScan, onProgress);
      if (DEBUG) console.log('Stats received in updateStats:', stats);

      if (!stats) {
        if (DEBUG) console.log('[StatsDebug] No stats available (no character selected). Zeroing UI.');
        $("#ccs-messages").text('--');
        $("#ccs-words").text('--');
        $("#ccs-start").text('--');
        $("#ccs-days").text('--');
        $("#ccs-total-size").text('--');
        updateActionButtonsState(0);
        return;
      }

      const chatFilesCount = stats.chatFilesCount || 0;

      // 始终显示字数估算提示
      $("#ccs-tip").show();

      if (!stats.firstTime && (!stats.messageCount || stats.messageCount === 0)) {
        // 只有当 firstTime 和 messageCount 都为空时，才认定为真正的"尚未互动"
        if (DEBUG) console.log('No firstTime AND no messages, zeroing UI');
        $("#ccs-messages").text("0");
        $("#ccs-words").text("0");
        $("#ccs-total-size").text("0 B");
        $("#ccs-start").text("尚未互动");
        $("#ccs-days").text("0");
        updateActionButtonsState(0);
      } else if (!stats.firstTime) {
        // firstTime 未知但有消息数据 —— 显示有效数据，日期标记为未知
        if (DEBUG) console.log('No firstTime but has messages, showing partial data');
        $("#ccs-messages").text(stats.messageCount || 0);
        $("#ccs-words").text(stats.wordCount || 0);

        // 即使没有初遇时间，也要显示回忆大小
        let formattedSize = '--';
        if (stats.totalSizeBytes !== undefined && stats.totalSizeBytes >= 0) {
          const bytes = stats.totalSizeBytes;
          const kb = bytes / 1024;
          const mb = kb / 1024;
          if (mb >= 1) {
            formattedSize = `${mb.toFixed(2)} MB`;
          } else if (kb >= 1) {
            formattedSize = `${kb.toFixed(2)} KB`;
          } else {
            formattedSize = `${bytes} B`;
          }
        }
        $("#ccs-total-size").text(formattedSize);

        $("#ccs-start").text("未知时间");
        $("#ccs-days").text("--");
        updateActionButtonsState(stats.messageCount);
      } else {
        // 更新统计数据到UI
        $("#ccs-messages").text(stats.messageCount || 0);
        $("#ccs-words").text(stats.wordCount || 0);

        // Format total size dynamically (KB or MB)
        let formattedSize = '--';
        if (stats.totalSizeBytes !== undefined && stats.totalSizeBytes >= 0) {
          const bytes = stats.totalSizeBytes;
          const kb = bytes / 1024;
          const mb = kb / 1024;

          if (mb >= 1) {
            formattedSize = `${mb.toFixed(2)} MB`;
          } else if (kb >= 1) {
            formattedSize = `${kb.toFixed(2)} KB`;
          } else {
            formattedSize = `${bytes} B`; // Display bytes if less than 1 KB
          }
        }
        $("#ccs-total-size").text(formattedSize);

        const now = new Date();
        // Ensure stats.firstTime is a Date object
        const firstTimeDate = stats.firstTime instanceof Date ? stats.firstTime : new Date(stats.firstTime);
        if (DEBUG) console.log('First time date:', firstTimeDate);

        // 使用 UTC 日期来避免时区问题
        const utcNow = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
        const utcFirstTime = Date.UTC(firstTimeDate.getFullYear(), firstTimeDate.getMonth(), firstTimeDate.getDate());

        // 计算天数：从第一次互动到现在的天数（包括今天）
        const diffTime = Math.abs(utcNow - utcFirstTime);
        const days = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1; // 加1确保包括今天
        if (DEBUG) console.log('Calculated days:', days);

        // 格式化初遇时间
        const firstTimeFormatted = formatDateTime(stats.firstTime);
        if (DEBUG) console.log('Formatted first time:', firstTimeFormatted);

        $("#ccs-start").text(firstTimeFormatted);
        $("#ccs-days").text(days);
        // 保存高级统计数据
        currentAdvancedStats = stats.advanced;
        lastDeepScanPartial = stats.deepScanPartial || false;
        // Pass messageCount to the state function
        updateActionButtonsState(stats.messageCount);
      }
      // Removed the stray 'else' block that was here


      if (DEBUG) {
        console.log('Stats UI updated:', {
          messages: stats.messageCount,
          words: stats.wordCount,
          firstTime: stats.firstTime,
          days: $("#ccs-days").text(),
          advanced: currentAdvancedStats
        });
      }

    } catch (error) {
      console.error('更新统计数据失败:', error);
      currentAdvancedStats = null;
      // 显示错误状态
      $("#ccs-messages").text('--');
      $("#ccs-words").text('--');
      $("#ccs-start").text('--');
      $("#ccs-days").text('--');
      $("#ccs-total-size").text('--'); // Clear size on error too
      updateActionButtonsState(0); // Pass 0 on error to ensure disabled state
    }
  }

  function getCharacterAvatar() {
    const messages = document.querySelectorAll('#chat .mes');
    for (const msg of messages) {
      const isUser = msg.getAttribute('is_user') === 'true';
      if (!isUser) {
        const avatar = msg.querySelector('.avatar img');
        if (avatar) {
          return avatar.src;
        }
      }
    }
    return null;
  }

  function getUserAvatar() {
    // Priority 1: Try to get avatar from current chat messages
    const messages = document.querySelectorAll('#chat .mes');
    for (const msg of messages) {
      const isUser = msg.getAttribute('is_user') === 'true';
      if (isUser) {
        const avatar = msg.querySelector('.avatar img');
        if (avatar && avatar.src) {
          if (DEBUG) console.log("getUserAvatar: Found avatar in chat message.");
          return avatar.src;
        }
      }
    }

    // Priority 2 (Fallback): Try to get avatar from persona selection
    const userAvatarContainer = document.querySelector('.avatar-container[data-avatar-id="user-default.png"]');
    if (userAvatarContainer) {
      const avatar = userAvatarContainer.querySelector('img');
      if (avatar && avatar.src) {
        if (DEBUG) console.log("getUserAvatar: Found avatar in persona selection.");
        return avatar.src;
      }
    }

    if (DEBUG) console.log("getUserAvatar: Could not find user avatar.");
    return null; // Return null if not found in either place
  }

  function toChineseNumber(num) {
    if (num === 0) return '零';
    const numChars = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九'];
    let result = '';
    
    if (num < 100) {
        if (num < 10) return numChars[num];
        const tens = Math.floor(num / 10);
        const ones = num % 10;
        if (tens === 1) result = '十';
        else result = numChars[tens] + '十';
        if (ones > 0) result += numChars[ones];
        return result;
    }
    if (num >= 10000) {
        let wan = Math.floor(num / 10000);
        let qian = Math.floor((num % 10000) / 1000);
        let res = toChineseNumber(wan) + '万';
        if (qian > 0) res += numChars[qian] + '千';
        return res;
    }
    if (num >= 1000) {
        let qian = Math.floor(num / 1000);
        let bai = Math.floor((num % 1000) / 100);
        let res = numChars[qian] + '千';
        if (bai > 0) res += numChars[bai] + '百';
        return res;
    }
    if (num >= 100) {
        let bai = Math.floor(num / 100);
        let shi = Math.floor((num % 100) / 10);
        let res = numChars[bai] + '百';
        if (shi > 0) res += numChars[shi] + '十';
        return res;
    }
    return result;
  }

  function formatAncientSize(sizeStr) {
    if (!sizeStr || sizeStr === '--') return "未知";
    const match = sizeStr.match(/^([\d.]+)\s*(\w+)$/i);
    if (!match) return sizeStr;
    const val = parseFloat(match[1]);
    const unit = match[2].toUpperCase();
    if (unit === 'MB') {
        if (val < 1) return '不到一兆';
        return toChineseNumber(Math.floor(val)) + '兆余';
    } else if (unit === 'GB') {
        return toChineseNumber(Math.floor(val * 1024)) + '兆余';
    } else if (unit === 'KB') {
        if (val >= 1000) return toChineseNumber(Math.floor(val/1000)) + '兆余';
        return toChineseNumber(Math.floor(val)) + '千字节余';
    }
    return toChineseNumber(Math.floor(val)) + '字节';
  }

  function drawVerticalText(ctx, text, x, y, lineHeight) {
    for (let i = 0; i < text.length; i++) {
        ctx.fillText(text[i], x, y + i * lineHeight);
    }
  }

  async function generateShareImage() {
    const isDark = shareStyle === 'modern-dark' || shareStyle === 'dark';
    const isPixel = shareStyle === 'pixel-pink';
    const isPocketSticker = shareStyle === 'pocket-sticker' || shareStyle === 'pocket-sticker-blue';
    const isY2k = shareStyle === 'nostalgic-y2k';
    const isModern = shareStyle === 'modern-light' || shareStyle === 'modern-dark' || shareStyle === 'modern';
    const isAncient = shareStyle === 'ancient';

    // 强制等待所有字体加载完毕，防止 Canvas 渲染时回退到默认字体
    await document.fonts.ready;
    
    const sampleEl = document.querySelector('.ccs-global-title') || document.body;
    const baseFontFamily = getComputedStyle(sampleEl).fontFamily || '"LXGW Neo XiHei", "PingFang SC", sans-serif';

    const canvas = document.getElementById('ccs-canvas');
    const ctx = canvas.getContext('2d');
    const charName = getCurrentCharacterName();

    const scaleFactor = 2; // HD
    const width = (isPocketSticker || isY2k) ? 896 * scaleFactor : 663 * scaleFactor;

    // Scrapbook Pixel Colors
    const pixelBg = '#FEF9F0'; // Warm Cream
    const pixelBorder = '#F4A7B9'; // Antique Rose
    const pixelHighlight = '#FFFFFF';
    const pixelShadow = '#E198AA';
    const pixelText = '#6B3E26'; // Cocoa Brown/Dark Pink
    const pixelBoxBg = '#FFFFFF';
    const pixelBoxBorder = '#553311';

    const tealColor = isDark ? '#2F3033' : '#F7F9FB';
    const cardBgColor = isPixel ? pixelBg : (isDark ? '#2F3033' : '#F7F9FB');
    const contentAreaBg = isDark ? '#1C1D1E' : '#EFF2F4';
    const statBoxColor = isPixel ? pixelBoxBg : (isDark ? '#2F3033' : '#F7F9FB');
    const shadowColor = isDark ? 'rgba(19, 19, 19, 0.6)' : 'rgba(218, 227, 232, 0.6)';

    const statLabelColor = isPixel ? '#1A1A1A' : (isDark ? '#FAFBF7' : '#131313');
    const statValueColor = isPixel ? '#1A1A1A' : (isDark ? '#FAFBF7' : '#131313');
    const charNameColor = isPixel ? pixelText : (isDark ? '#FAFBF7' : '#131313');
    const dashColor = '#FFFFFF';

    // 0. 加载资产 (Ins & Pixel Style & Ancient)
    const insAssets = {};
    const pixelAssets = {};
    const ancientAssets = {};
    const pocketAssets = {};
    const y2kAssets = {};
    
    const loadAssetImg = (url) => new Promise((resolve) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      const timeout = setTimeout(() => {
        console.warn(`Asset load timeout: ${url}`);
        resolve(null);
      }, 5000);
      img.onload = () => { clearTimeout(timeout); resolve(img); };
      img.onerror = () => { clearTimeout(timeout); resolve(null); };
      img.src = url;
    });

    if (shareStyle === 'ancient') {
      const v = Date.now();
      ancientAssets.bg = await loadAssetImg(`${extensionWebPath}/assets/ancient-bg.png?v=${v}`);
    }

    if (isPocketSticker) {
      const v = Date.now();
      const bgImage = shareStyle === 'pocket-sticker-blue' ? 'sticker-bg-blue.png' : 'sticker-bg.png';
      pocketAssets.bg = await loadAssetImg(`${extensionWebPath}/assets/${bgImage}?v=${v}`);
      pocketAssets.decor = await loadAssetImg(`${extensionWebPath}/assets/heart-decor.svg?v=${v}`);
    }

    if (isY2k) {
      const v = Date.now();
      const y2kAssetList = {
        bg: `${extensionWebPath}/assets/nostalgicpurple/nostagic_bg.png?v=${v}`,
        calendar: `${extensionWebPath}/assets/nostalgicpurple/calendaricon.svg?v=${v}`,
        chat: `${extensionWebPath}/assets/nostalgicpurple/chaticon.svg?v=${v}`,
        disc: `${extensionWebPath}/assets/nostalgicpurple/discicon.svg?v=${v}`,
        number: `${extensionWebPath}/assets/nostalgicpurple/number.svg?v=${v}`
      };
      await Promise.all(Object.entries(y2kAssetList).map(async ([key, url]) => {
        y2kAssets[key] = await loadAssetImg(url);
      }));
    }

    if (shareStyle === 'ins') {
      const v = Date.now();
      insAssets.bg = await loadAssetImg(`${extensionWebPath}/assets/mesh-bg.svg?v=${v}`);
    }

    if (isPixel) {
      if (DEBUG) console.log('Loading pixel assets...');
      const v = Date.now();
      const pixelAssetList = {
        header: `${extensionWebPath}/assets/headerbackground.png?v=${v}`,
        chats: `${extensionWebPath}/assets/chats.png?v=${v}`,
        days: `${extensionWebPath}/assets/days.png?v=${v}`,
        characters: `${extensionWebPath}/assets/characters.png?v=${v}`,
        size: `${extensionWebPath}/assets/size.png?v=${v}`,
        decor: `${extensionWebPath}/assets/decor.png?v=${v}`
      };

      await Promise.all(Object.entries(pixelAssetList).map(async ([key, url]) => {
        pixelAssets[key] = await loadAssetImg(url);
      }));
    }

    // Instagram Icons from Figma (SVG Paths)
    const insIcons = {
      heart: "M18 10C18 10 14.5 5 9.5 5C4 5 3 11 3 14.5C3 19 8.5 24 18 31C27.5 24 33 19 33 14.5C33 11 32 5 26.5 5C21.5 5 18 10 18 10Z",
      comment: "M3 17C3 9.26801 9.26801 3 17 3C24.732 3 31 9.26801 31 17C31 24.732 24.732 31 17 31C14.757 31 12.6366 30.4716 10.7584 29.5392L3 32L5.80803 24.976C4.01186 22.75 3 19.9983 3 17Z",
      share: "M32 4L4 16L15 21L20 32L32 4ZM15 21L32 4",
      bookmark: "M8 3V32L18 25L28 32V3H8Z",
      more: "M5.69238 14C7.73155 14 9.38477 15.6532 9.38477 17.6924C9.38473 19.7315 7.73153 21.3847 5.69238 21.3848C3.6532 21.3848 2.00004 19.7316 2 17.6924C2 15.6532 3.65318 14 5.69238 14ZM18 14C20.0392 14 21.6924 15.6532 21.6924 17.6924C21.6924 19.7316 20.0392 21.3848 18 21.3848C15.9608 21.3848 14.3076 19.7316 14.3076 17.6924C14.3076 15.6532 15.9608 14 18 14ZM30.3076 14C32.3468 14 34 15.6532 34 17.6924C34 19.7316 32.3468 21.3848 30.3076 21.3848C28.2684 21.3847 26.6152 19.7316 26.6152 17.6924C26.6152 15.6532 28.2684 14 30.3076 14Z"
    };

    // 1. 获取选中的统计项
    const statsItems = [
      { id: 'ccs-share-messages', label: '聊天对话', value: $("#ccs-messages").text(), unit: '条' },
      { id: 'ccs-share-days', label: '相伴天数', value: $("#ccs-days").text(), unit: '天' },
      { id: 'ccs-share-words', label: '聊天字数', value: $("#ccs-words").text(), unit: '字' },
      {
        id: 'ccs-share-size', label: '回忆大小', value: (() => {
          const val = $("#ccs-total-size").text();
          const match = val.match(/^([\d.]+)\s*(\w+)$/);
          return match ? match[1] : val;
        })(), unit: (() => {
          const val = $("#ccs-total-size").text();
          const match = val.match(/^([\d.]+)\s*(\w+)$/);
          return match ? match[2] : '';
        })()
      }
    ];

    // 如果是青纹信笺、像素风或怀旧y2k，则加上初遇时间显示 (现代简约默认不加)
    if (isAncient || isPixel || isY2k) {
      statsItems.unshift({ id: 'ccs-share-start', label: '初遇时间', value: $("#ccs-start").text().replace(/约/g, '').replace(/点/g, ':').replace(/分/g, '') });
    }

    let stats = statsItems.filter(s => $(`#${s.id}`).is(":checked"));
    
    if (isPixel || isY2k) {
      stats = stats.filter(s => s.id !== 'ccs-share-start');
    }

    if (isPocketSticker || isY2k) {
      stats = stats.map(s => {
        let newValue = s.value;
        if (s.id === 'ccs-share-words') {
          let num = parseInt(s.value.replace(/,/g, '')) || 0;
          if (num >= 10000) {
            let formatted = (num / 10000).toFixed(1);
            if (formatted.endsWith('.0')) {
              formatted = formatted.substring(0, formatted.length - 2);
            }
            newValue = formatted + 'w';
          }
        }
        return { ...s, label: s.label, value: newValue, unit: s.unit };
      });
    }

    if (shareStyle === 'ancient') {
      stats = stats.map(s => {
        let newLabel = s.label;
        let newValue = s.value;
        if (s.id === 'ccs-share-start') {
          newLabel = '初见';
          const rawText = $("#ccs-start").text().replace(/点/g, ':').replace(/分/g, '').replace(/-/g, '/');
          const dt = new Date(rawText);
          if (!isNaN(dt.getTime())) {
            newValue = `${toChineseNumber(dt.getFullYear())}年${toChineseNumber(dt.getMonth()+1)}月${toChineseNumber(dt.getDate())}日`;
          } else {
            // Some fallback if it cannot be parsed as a valid date
            const match = rawText.match(/(\d{4}).*?(\d{1,2}).*?(\d{1,2})/);
            if (match) {
               newValue = `${toChineseNumber(parseInt(match[1]))}年${toChineseNumber(parseInt(match[2]))}月${toChineseNumber(parseInt(match[3]))}日`;
            } else {
               newValue = rawText === '尚未互动' ? '尚未互动' : '未知';
            }
          }
          s.unit = '';
        } else if (s.id === 'ccs-share-messages') {
          newLabel = '对话';
          newValue = toChineseNumber(parseInt(s.value) || 0);
          s.unit = '则';
        } else if (s.id === 'ccs-share-days') {
          newLabel = '相伴';
          newValue = toChineseNumber(parseInt(s.value) || 0);
          s.unit = '日';
        } else if (s.id === 'ccs-share-words') {
          newLabel = '字数';
          newValue = '约' + toChineseNumber(parseInt(s.value.replace(/,/g, '')) || 0);
          s.unit = '字';
        } else if (s.id === 'ccs-share-size') {
          newLabel = '忆存';
          const totalSizeRaw = $("#ccs-total-size").text();
          newValue = formatAncientSize(totalSizeRaw);
          s.unit = '';
        }
        return { ...s, label: newLabel, value: newValue };
      });
    }

    // Base Values (Unscaled)
    const baseWidth = 663;
    const baseHeaderH_Pixel = 324;
    const baseHeaderPadding = 16;
    const baseBoxH_Pixel = 90;
    const baseBoxGap_Pixel = 20;
    const baseHeaderToBoxGap = 24;

    const headerW = 631 * scaleFactor;
    const headerH = (shareStyle === 'ins' ? 144 : (isPixel ? (baseHeaderH_Pixel + baseHeaderPadding) : 214)) * scaleFactor;
    const footerH = (shareStyle === 'ins' ? 92 : 48) * scaleFactor;
    
    const boxW = isPocketSticker ? 600 * scaleFactor : (isPixel ? 615 * scaleFactor : 519 * scaleFactor);
    const boxH = (isPocketSticker ? 50 : (isPixel ? baseBoxH_Pixel : 80)) * scaleFactor;
    const boxGap = (isPocketSticker ? 30 : (shareStyle === 'ins' ? 24 : (isPixel ? baseBoxGap_Pixel : 32))) * scaleFactor;

    const headerToBoxGap = baseHeaderToBoxGap * scaleFactor;
    
    // Content area positioning
    let totalStatsH;
    if (shareStyle === 'ins') {
      totalStatsH = 500 * scaleFactor; // Fixed height for ins content
    } else if (isPixel) {
      // Dynamic height for Pixel style: 24px gap + stats
      const statsContentH = stats.length > 0 
        ? (stats.length * boxH + (stats.length - 1) * boxGap + headerToBoxGap)
        : 0;
      totalStatsH = statsContentH + (40 * scaleFactor); // Bottom padding increased to 40px
    } else {
      totalStatsH = (stats.length > 0 ? (stats.length * boxH + (stats.length - 1) * boxGap + 80 * scaleFactor) : 0);
    }

    let height = headerH + totalStatsH + (isPixel ? 0 : footerH);
    if (shareStyle === 'ancient') {
      height = 816 * scaleFactor;
    } else if (isPocketSticker || isY2k) {
      height = 1216 * scaleFactor;
    }
    const dynamicHeight = height;

    // 现代版底色区域 (This block is now mostly for non-ins styles)
    const contentAreaMargin = 32 * scaleFactor;
    const contentAreaW = isModern ? 599 * scaleFactor : (540 * scaleFactor);
    // const contentAreaH = hasStats ? (statsAreaH + 80 * scaleFactor) : 0; // Padding inside content (now totalStatsH)

    canvas.width = width;
    canvas.height = dynamicHeight;

    // Apply 16px border radius to the entire card
    ctx.save();
    if (shareStyle === 'ancient') {
       // ancient style doesn't need border radius
       ctx.rect(0, 0, width, dynamicHeight);
    } else {
       roundRect(0, 0, width, dynamicHeight, 16 * scaleFactor, false, false);
    }
    ctx.clip();

    // 尝试加载字体并等待加载完成
    try {
      if (document.fonts) {
        // 使用最终处理后的 stats 数组（包含青纹信笺转换后的中文数字和单位）来提取字符，确保子集字体正确加载
        const statChars = Array.from(new Set(stats.map(s => (s.label + s.value + (s.unit || '')).split('')).flat())).join('');

        // Trigger font loading
        const fontPromises = [
          document.fonts.load(`400 32px "LXGW Neo XiHei"`, charName + statChars + '初遇'),
          document.fonts.load(`700 32px "LXGW Neo XiHei"`, statChars),
          document.fonts.load(`400 32px "PING FANG SHAO HUA"`, statChars),
          document.fonts.load(`400 32px "Cubic 11"`, charName + statChars + '初遇'),
          document.fonts.load(`400 32px "MaoKenTangYuan (beta)"`, charName + statChars + '初遇'),
          document.fonts.load(`700 32px "MaoKenTangYuan (beta)"`, statChars),
          document.fonts.load(`400 32px "Xiaolai"`, charName + statChars + '初遇'),
          document.fonts.load(`700 32px "Xiaolai"`, statChars),
          document.fonts.load(`400 48px "Long Cang"`, '初遇'),
          document.fonts.load(`400 32px "PING FANG GONG ZI TI"`, charName + statChars + '初见')
        ];

        // Wait for fonts to load, with a timeout to prevent hanging forever
        const timeoutPromise = new Promise(resolve => setTimeout(resolve, 1500));
        await Promise.race([Promise.all(fontPromises), timeoutPromise]);
      }
    } catch (e) {
      if (DEBUG) console.warn('Font load trigger failed:', e);
    }

    // Helper: Rounded Rect
    function roundRect(x, y, w, h, r, fill = true, stroke = false) {
      if (r === 0) {
        ctx.beginPath();
        ctx.rect(x, y, w, h);
        if (fill) ctx.fill();
        if (stroke) ctx.stroke();
        return;
      }
      ctx.beginPath();
      ctx.moveTo(x + r, y);
      ctx.arcTo(x + w, y, x + w, y + h, r);
      ctx.arcTo(x + w, y + h, x, y + h, r);
      ctx.arcTo(x, y + h, x, y, r);
      ctx.arcTo(x, y, x + w, y, r);
      ctx.closePath();
      if (fill) ctx.fill();
      if (stroke) ctx.stroke();
    }

    // 3. 绘制背景
    if (shareStyle === 'ancient') {
      if (ancientAssets.bg) {
        ctx.drawImage(ancientAssets.bg, 0, 0, width, height);
      } else {
        ctx.fillStyle = '#f0e6d2'; // Fallback paper color
        ctx.fillRect(0, 0, width, height);
      }
    } else if (isPocketSticker || isY2k) {
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(0, 0, width, height);
      if (isY2k && y2kAssets.bg) {
        ctx.drawImage(y2kAssets.bg, 0, 0, width, height);
      } else if (isPocketSticker && pocketAssets.bg) {
        ctx.drawImage(pocketAssets.bg, 0, 0, width, height);
      }
    } else {
      ctx.fillStyle = (shareStyle === 'ins') ? '#FFFFFF' : (isPixel ? '#F1BDC3' : tealColor); // Solid color background
      if (shareStyle === 'ins') {
        roundRect(0, 0, width, height, 24 * scaleFactor);
      } else {
        ctx.fillRect(0, 0, width, height); // Fill whole background
      }
    }


    // 4. 内容区域背景
    if (shareStyle === 'ins') {
      const w = width;
      const h = totalStatsH;
      const y0 = headerH;

      // Mesh Gradient for Ins Style - Use PNG/SVG if loaded, else skip mesh generator
      if (insAssets.bg) {
        ctx.drawImage(insAssets.bg, 0, headerH, width, totalStatsH);
      } else {
        ctx.fillStyle = '#fdfbfb'; // Fallback
        ctx.fillRect(0, headerH, width, totalStatsH);
      }
    } else if (isPixel) {
      // Pixel Pink Background - Simple pink fill already done in step 3
    } else if (shareStyle === 'ancient') {
      // Ancient style doesn't need a content area background box
    } else if (isPocketSticker || isY2k) {
      // Pocket sticker and Y2K don't need a content area background box
    } else if (stats.length > 0) {
      ctx.fillStyle = contentAreaBg;
      const contentAreaW = 599 * scaleFactor;
      const contentAreaX = (width - contentAreaW) / 2;
      // const contentAreaH = totalStatsH; // Already defined as totalStatsH
      roundRect(contentAreaX, headerH, contentAreaW, totalStatsH, 24 * scaleFactor);
    }


    // 4. 绘制头像 (Moved to after background, before header logic)
    if (isAncient) {
      // 青纹信笺专属竖排绘制
      ctx.save();
      ctx.fillStyle = '#2c2824'; // 深墨色
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';

      // 角色名往下 6px (44+6=50), 保持 x 不变 (579)
      const charNameX = 579 * scaleFactor;
      const charNameY = 50 * scaleFactor;
      
      // 绘制角色名 (调整为 100px)
      ctx.font = `400 ${100 * scaleFactor}px "PING FANG GONG ZI TI", "Long Cang", sans-serif`;
      drawVerticalText(ctx, charName || "角色名", charNameX, charNameY, 110 * scaleFactor);

      // 调整格子中心点: 
      // 初见(idx 0)左移1px (466.5->465.5)
      const gridCenters = [465.5, 387.5, 306.5, 226.0, 144.0, 70.5].map(x => x * scaleFactor);
      const statYStart = 136 * scaleFactor; 

      // 绘制各项数据 (字号调整为 43px)
      const statFontSize = 43 * scaleFactor;
      const statLineHeight = 45 * scaleFactor;
      const labelValueGap = 64 * scaleFactor; 

      ctx.font = `400 ${statFontSize}px "PING FANG GONG ZI TI", "LXGW Neo XiHei", sans-serif`; 
      stats.forEach((stat, i) => {
         if (i >= gridCenters.length) return;
         const cx = gridCenters[i];
         
         // 分开绘制 Label 和 Value 以控制间距
         drawVerticalText(ctx, stat.label, cx, statYStart, statLineHeight);
         
         const labelYEnd = statYStart + stat.label.length * statLineHeight;
         const valueYStart = labelYEnd + labelValueGap;
         
         drawVerticalText(ctx, stat.value + stat.unit, cx, valueYStart, statLineHeight);
      });
      ctx.restore();
    } else {
    // 现代版、Ins版、像素版绘制头像和统计项
    const avatarUrl = getCharacterAvatar();
    const userAvatarUrl = getUserAvatar();

    const loadImg = (url) => new Promise((resolve) => {
      if (!url) return resolve(null);
      const img = new Image();
      img.crossOrigin = 'anonymous';
      const timeout = setTimeout(() => {
        console.warn(`Avatar load timeout: ${url}`);
        resolve(null);
      }, 5000);
      img.onload = () => { clearTimeout(timeout); resolve(img); };
      img.onerror = () => { clearTimeout(timeout); resolve(null); };
      img.src = url;
    });

    const [charImg, userImg] = await Promise.all([loadImg(avatarUrl), loadImg(userAvatarUrl)]);

    function drawRoundedAvatar(img, x, y, w, h, r) {
      ctx.save();
      roundRect(x, y, w, h, r, false, false);
      ctx.clip();
      if (img) {
        const scale = Math.max(w / img.width, h / img.height);
        const sw = img.width * scale;
        const sh = img.height * scale;
        ctx.drawImage(img, x + (w - sw) / 2, y + (h - sh) / 2, sw, sh);
      } else {
        ctx.fillStyle = '#e0e0e0';
        ctx.fillRect(x, y, w, h);
      }
      ctx.restore();
    }

    const showUser = $("#ccs-share-user-avatar").is(":checked") && userImg;
    const showEncounterDate = $("#ccs-share-start").is(":checked");
    const centerY = headerH / 2;

    if (shareStyle === 'ins') {
      const avatarW = 72 * scaleFactor;
      const avatarH = 72 * scaleFactor;
      const avatarY = (headerH - avatarH) / 2;
      const startX = 24 * scaleFactor;

      function drawInsAvatar(img, x, y) {
        if (!img) return;
        ctx.save();
        // White Background & Light Gray Border behind Avatar
        ctx.beginPath();
        ctx.arc(x + avatarW / 2, y + avatarH / 2, avatarW / 2 + 4 * scaleFactor, 0, Math.PI * 2);
        ctx.fillStyle = '#FFFFFF';
        ctx.fill();
        ctx.lineWidth = 1 * scaleFactor;
        ctx.strokeStyle = '#EFEFEF'; // Very light gray border
        ctx.stroke();

        // Image
        ctx.beginPath();
        ctx.arc(x + avatarW / 2, y + avatarH / 2, avatarW / 2, 0, Math.PI * 2);
        ctx.clip();
        // Use charImg/userImg directly, no need to reload
        const iw = img.width;
        const ih = img.height;
        const r = Math.max(avatarW / iw, avatarH / ih);
        const nw = iw * r;
        const nh = ih * r;
        const sx = (iw - avatarW / r) / 2;
        const sy = (ih - avatarH / r) / 2;
        ctx.drawImage(img, sx, sy, avatarW / r, avatarH / r, x, y, avatarW, avatarH);
        ctx.restore();
      }

      if (showUser) {
        drawInsAvatar(userImg, startX + 44 * scaleFactor, avatarY); // User RIGHT (bottom), separated by 44 instead of 36
        drawInsAvatar(charImg, startX, avatarY); // Character LEFT (top)
      } else {
        drawInsAvatar(charImg, startX, avatarY);
      }

      // Title & Encounter
      const textX = startX + (showUser ? (avatarW + 44 * scaleFactor + 16 * scaleFactor) : (avatarW + 16 * scaleFactor));
      ctx.textAlign = 'left';

      ctx.fillStyle = '#131313';
      ctx.font = `400 ${24 * scaleFactor}px "LXGW Neo XiHei", sans-serif`;

      if (showEncounterDate) {
        ctx.fillText(charName, textX, avatarY + 28 * scaleFactor);
        ctx.fillStyle = '#5E5E5E';
        ctx.font = `400 ${22 * scaleFactor}px "LXGW Neo XiHei", sans-serif`;
        ctx.fillText(`初遇 ${$("#ccs-start").text()}`, textX, avatarY + 60 * scaleFactor);
      } else {
        // Center the name vertically if encounter date is not shown
        ctx.fillText(charName, textX, centerY + 8 * scaleFactor);
      }

      // Three Dots Icon
      ctx.save();
      ctx.translate(width - 48 * scaleFactor, centerY);
      ctx.fillStyle = '#4F4F4F'; // Figma color
      const p = (shareStyle === 'ins' && insIcons.more) ? new Path2D(insIcons.more) : null;
      if (p) {
        ctx.scale(1 * scaleFactor, 1 * scaleFactor); // Figma: 36px total, path fits in 36x36
        ctx.translate(-18, -18); // Center 36x36 path
        ctx.fill(p);
      }
      ctx.restore();

    } else if (isPixel) {
      // --- NEW PINK PIXEL HEADER ---
      const headerImg = pixelAssets.header;
      if (headerImg) {
        // Precise positioning: 16px from top, 16px from left
        ctx.drawImage(headerImg, 16 * scaleFactor, 16 * scaleFactor, 631 * scaleFactor, 324 * scaleFactor);
      }

      // Avatar Slots Positioning (User absolute coordinates)
      const avatarSize = 102 * scaleFactor;
      const charAvatarX = 145 * scaleFactor; // Updated from 45 to 145
      const userAvatarX = 415 * scaleFactor; 
      const avatarY = 70 * scaleFactor; 
      
      // Draw Avatars - Corner radius reduced to 5 for sharper look
      drawRoundedAvatar(charImg, charAvatarX, avatarY, avatarSize, avatarSize, 5 * scaleFactor);
      if (showUser) {
        drawRoundedAvatar(userImg, userAvatarX, avatarY, avatarSize, avatarSize, 5 * scaleFactor);
      }

      // Name and Encounter
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top'; // Set to top for precise Y positioning
      ctx.fillStyle = '#773831'; 
      ctx.font = `400 ${34 * scaleFactor}px "Cubic 11", sans-serif`;
      const nameText = charName || "角色名";
      ctx.fillText(nameText, width / 2, 206 * scaleFactor);
      
      if (showEncounterDate) {
        ctx.font = `400 ${26 * scaleFactor}px "Cubic 11", sans-serif`;
        const encounterText = `初遇于 ${$("#ccs-start").text()}`;
        // Nudged down slightly to 258px
        ctx.fillText(encounterText, width / 2, 258 * scaleFactor);
      }
      ctx.textBaseline = 'alphabetic'; // Reset to default

    } else if (isPocketSticker) {
      // 5. Pocket Sticker Avatars & Name
      const avatarW = 188 * scaleFactor;
      const avatarH = 271 * scaleFactor;
      const charAvatarX = 226 * scaleFactor;
      const userAvatarX = 482 * scaleFactor;
      const avatarY = 58 * scaleFactor;
      
      // No rounded corners, use drawRoundedAvatar to crop and fit without distortion
      drawRoundedAvatar(charImg, charAvatarX, avatarY, avatarW, avatarH, 0);
      if (showUser) {
        drawRoundedAvatar(userImg, userAvatarX, avatarY, avatarW, avatarH, 0);
      }

      // Draw heart decor
      if (pocketAssets.decor) {
        const decorAspect = pocketAssets.decor.height / pocketAssets.decor.width;
        const decorW = 115 * scaleFactor;
        const decorH = decorW * decorAspect;
        const gapCenterX = (charAvatarX + avatarW + userAvatarX) / 2;
        ctx.drawImage(pocketAssets.decor, gapCenterX - decorW / 2, avatarY + avatarH / 2 - decorH / 2, decorW, decorH);
      }
      
      // Name and Encounter
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.fillStyle = 'rgba(0, 0, 0, 0.95)';
      ctx.font = `400 ${45 * scaleFactor}px "Xiaolai", sans-serif`;
      ctx.fillText(charName || "角色名", width / 2, 377 * scaleFactor);
      
      if (showEncounterDate) {
        ctx.font = `400 ${26 * scaleFactor}px "Xiaolai", sans-serif`;
        const encounterText = `初遇于 ${$("#ccs-start").text()}`;
        ctx.fillText(encounterText, width / 2, 440 * scaleFactor);
      }
      ctx.textBaseline = 'alphabetic'; // Reset

    } else if (isY2k) {
      // Name (Title Bar)
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      ctx.fillStyle = '#7E3D8E';
      ctx.font = `400 ${34 * scaleFactor}px "Cubic 11", sans-serif`;
      const titleText = `${charName || "角色名"}_chatlog.png`;
      ctx.fillText(titleText, 107 * scaleFactor, 73 * scaleFactor);

      // Encounter Date
      if (showEncounterDate) {
        ctx.textAlign = 'center';
        ctx.font = `400 ${36 * scaleFactor}px "Cubic 11", sans-serif`;
        const rawStart = $("#ccs-start").text();
        const dateMatch = rawStart.match(/(\d{4})年(\d{1,2})月(\d{1,2})日/);
        const formattedDate = dateMatch 
          ? `${dateMatch[1]}/${dateMatch[2].padStart(2, '0')}/${dateMatch[3].padStart(2, '0')}` 
          : rawStart.replace(/约/g, '').split(' ')[0];
        const encounterText = `First Encounter · ${formattedDate}`;
        ctx.fillText(encounterText, width / 2, 210 * scaleFactor);
      }
      ctx.textBaseline = 'alphabetic';

      // Avatars (Bottom Right Overlap)
      const drawY2kAvatar = (img, x, y) => {
        const avatarSize = 170 * scaleFactor;
        const borderSize = 4 * scaleFactor;

        // Border
        ctx.fillStyle = '#7E3D8E';
        ctx.fillRect(x - borderSize, y - borderSize, avatarSize + borderSize * 2, avatarSize + borderSize * 2);
        
        ctx.save();
        ctx.imageSmoothingEnabled = false; // Pixelated effect
        
        if (img) {
          // Fill background in case image has transparency
          ctx.fillStyle = '#FFFFFF';
          ctx.fillRect(x, y, avatarSize, avatarSize);
          
          // Pixelate using offscreen canvas
          const offCanvas = document.createElement('canvas');
          const pixelSize = 48; // Strong pixelation size
          offCanvas.width = pixelSize;
          offCanvas.height = pixelSize;
          const offCtx = offCanvas.getContext('2d');
          
          const scale = Math.max(pixelSize / img.width, pixelSize / img.height);
          const sw = img.width * scale;
          const sh = img.height * scale;
          
          offCtx.fillStyle = '#FFFFFF';
          offCtx.fillRect(0, 0, pixelSize, pixelSize);
          offCtx.drawImage(img, (pixelSize - sw) / 2, (pixelSize - sh) / 2, sw, sh);
          
          ctx.drawImage(offCanvas, x, y, avatarSize, avatarSize);
          
          // Add 30% #7E3D8E mask
          ctx.fillStyle = 'rgba(126, 61, 142, 0.3)';
          ctx.fillRect(x, y, avatarSize, avatarSize);
        } else {
          ctx.fillStyle = '#e0e0e0';
          ctx.fillRect(x, y, avatarSize, avatarSize);
        }
        ctx.restore();
      };

      if (showUser) {
        drawY2kAvatar(userImg, 632 * scaleFactor, 943 * scaleFactor); // User underneath
      }
      // Character overlaps user
      drawY2kAvatar(charImg, 501 * scaleFactor, 831 * scaleFactor); 

    } else {
      // Modern style header logic...
      const avatarW = 100 * scaleFactor;
      const avatarH = 100 * scaleFactor;
      const avatarGap = -27 * scaleFactor; // Decreased from -35 to -27 to separate by ~8px more
      const avatarY = (headerH - avatarH) / 2;

      function drawModernAvatar(img, x, y) {
        // Outer frame
        ctx.fillStyle = isDark ? '#37393B' : 'rgba(220, 221, 220, 1)';
        ctx.beginPath();
        ctx.arc(x + avatarW / 2, y + avatarH / 2, (avatarW / 2) + 6 * scaleFactor, 0, Math.PI * 2);
        ctx.fill();

        // Inner Shadow (cast by the avatar circle itself now)
        ctx.save();
        ctx.shadowColor = isDark ? 'rgba(19, 19, 19, 0.8)' : 'rgba(175, 183, 188, 0.8)';
        ctx.shadowBlur = 18 * scaleFactor;
        ctx.shadowOffsetY = 12 * scaleFactor;

        // Draw a dummy circle exact size of the avatar to cast the drop shadow
        ctx.fillStyle = isDark ? '#131313' : '#FFFFFF';
        ctx.beginPath();
        ctx.arc(x + avatarW / 2, y + avatarH / 2, avatarW / 2, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();

        // Image with Center Crop (Object-fit: cover)
        ctx.save();
        ctx.beginPath();
        ctx.arc(x + avatarW / 2, y + avatarH / 2, avatarW / 2, 0, Math.PI * 2);
        ctx.clip();
        if (img) {
          const iw = img.width;
          const ih = img.height;
          const r = Math.max(avatarW / iw, avatarH / ih);
          const nw = iw * r;
          const nh = ih * r;
          const sx = (iw - avatarW / r) / 2;
          const sy = (ih - avatarH / r) / 2;
          ctx.drawImage(img, sx, sy, avatarW / r, avatarH / r, x, y, avatarW, avatarH);
        } else {
          ctx.fillStyle = '#ddd';
          ctx.fill();
        }
        ctx.restore();
      };

      if (!showEncounterDate) { // Original logic for modern style when encounter date is not shown
        const combinedW = showUser ? (avatarW * 2 + avatarGap) : avatarW;
        const centerX = (width - combinedW) / 2;
        if (showUser) {
          drawModernAvatar(userImg, centerX + avatarW + avatarGap, avatarY); // User RIGHT (bottom)
        }
        drawModernAvatar(charImg, centerX, avatarY); // Character LEFT (top)
      } else { // Original logic for modern style when encounter date is shown
        const startX = 48 * scaleFactor;
        if (showUser) {
          drawModernAvatar(userImg, startX + avatarW + avatarGap, avatarY); // User RIGHT (bottom)
        }
        drawModernAvatar(charImg, startX, avatarY); // Character LEFT (top)
      }

      if (showEncounterDate) {
        const infoX = 246 * scaleFactor; // Moved to the right by 8px from 238
        const infoY = centerY;
        ctx.textAlign = 'left';

        // Name
        ctx.fillStyle = charNameColor;
        ctx.font = `400 ${31 * scaleFactor}px ${baseFontFamily}`; // Reverted to 400
        ctx.fillText(charName, infoX, infoY - 12 * scaleFactor); // Moved up slightly

        // Encounter Info
        const encounterText = `初遇 ${$("#ccs-start").text()}`;
        ctx.save();
        ctx.globalAlpha = 0.7; // 70% opacity per request
        ctx.fillStyle = statLabelColor;
        ctx.font = `400 ${25 * scaleFactor}px ${baseFontFamily}`; // Reverted to 400
        ctx.fillText(encounterText, infoX, infoY + 36 * scaleFactor); // Moved down slightly (+32 -> +36)
        ctx.restore();
      }
    }

    // 6. 绘制统计项
    const insContentH = 500 * scaleFactor;
    const actualStatsH = stats.length * boxH + (stats.length > 0 ? (stats.length - 1) * boxGap : 0);
    const statsStartY = (shareStyle === 'ins')
      ? (headerH + (insContentH - actualStatsH) / 2) // Vertically centered in fixed height
      : (isPixel ? (baseHeaderPadding + baseHeaderH_Pixel + baseHeaderToBoxGap) * scaleFactor : 
         (isPocketSticker ? 550 * scaleFactor : 
         (isModern ? (headerH + 40 * scaleFactor) : (headerH + 100 * scaleFactor + 40 * scaleFactor))));

    const boxX = (width - boxW) / 2;

    stats.forEach((stat, i) => {
      const cy = statsStartY + i * (boxH + boxGap);

      if (shareStyle === 'ins') {
        // Ins style: Left aligned with 40px spacing
        ctx.textAlign = 'left';
        ctx.fillStyle = '#131313';
        ctx.font = `400 ${45 * scaleFactor}px "PING FANG SHAO HUA", sans-serif`;

        const labelText = `${stat.label}   ${stat.value} ${stat.unit || ''}`;
        ctx.fillText(labelText, 40 * scaleFactor, cy + boxH / 2 + 10 * scaleFactor);

      } else if (isPocketSticker) {
        const pocketPositions = {
          '聊天对话': { x: 194.8 * scaleFactor, y: 614.58 * scaleFactor, rotation: -4.48 },
          '相伴天数': { x: 588.41 * scaleFactor, y: 658.19 * scaleFactor, rotation: 6.3 },
          '聊天字数': { x: 170.0 * scaleFactor, y: 940.53 * scaleFactor, rotation: -4.48 },
          '回忆大小': { x: 550.0 * scaleFactor, y: 979.45 * scaleFactor, rotation: 6.3 }
        };
        
        const pos = pocketPositions[stat.label] || { x: 100 * scaleFactor, y: cy, rotation: 0 };

        ctx.save();
        ctx.translate(pos.x, pos.y);
        ctx.rotate(pos.rotation * Math.PI / 180);

        ctx.fillStyle = 'rgba(0, 0, 0, 0.95)'; 
        
        const labelSize = 28 * scaleFactor;
        const valSize = 56 * scaleFactor;
        const unitSize = 24 * scaleFactor;

        // Measure widths to center the text blocks relative to each other
        ctx.font = `400 ${labelSize}px "Xiaolai", sans-serif`;
        const labelW = ctx.measureText(stat.label).width;

        ctx.font = `700 ${valSize}px "Xiaolai", sans-serif`;
        const valW = ctx.measureText(stat.value).width;

        ctx.font = `400 ${unitSize}px "Xiaolai", sans-serif`;
        const unitW = stat.unit ? ctx.measureText(stat.unit).width : 0;
        
        const valueAndUnitW = valW + (stat.unit ? 8 * scaleFactor : 0) + unitW;
        
        const maxW = Math.max(labelW, valueAndUnitW);
        const centerX = maxW / 2;

        // Draw label (top baseline so y is precise to user coords)
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        ctx.font = `400 ${labelSize}px "Xiaolai", sans-serif`;
        ctx.fillText(stat.label, centerX, -10 * scaleFactor);

        // Draw value + unit (alphabetic baseline for bottom alignment)
        const valY = labelSize + 15 * scaleFactor + valSize; // Approximate baseline position
        const groupStartX = centerX - valueAndUnitW / 2;

        ctx.textAlign = 'left';
        ctx.textBaseline = 'alphabetic';
        ctx.font = `700 ${valSize}px "Xiaolai", sans-serif`;
        ctx.fillText(stat.value, groupStartX, valY);

        if (stat.unit) {
          ctx.font = `400 ${unitSize}px "Xiaolai", sans-serif`;
          ctx.fillText(stat.unit, groupStartX + valW + 8 * scaleFactor, valY);
        }

        ctx.restore();

      } else if (isY2k) {
        const iconMap = {
          '聊天对话': y2kAssets.chat,
          '相伴天数': y2kAssets.calendar,
          '聊天字数': y2kAssets.number,
          '回忆大小': y2kAssets.disc
        };
        
        const icon = iconMap[stat.label];
        const iconSize = 72 * scaleFactor;
        
        // Horizontal list stacked vertically
        const baseX = 115 * scaleFactor;
        const baseY = 310 * scaleFactor;
        const verticalSpacing = 24 * scaleFactor;
        const rowY = baseY + i * (iconSize + verticalSpacing);
        
        if (icon) {
          ctx.drawImage(icon, baseX, rowY, iconSize, iconSize);
        }
        
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = '#7E3D8E';
        
        // Draw Label
        ctx.font = `400 ${40 * scaleFactor}px "Cubic 11", sans-serif`;
        const labelX = baseX + iconSize + 16 * scaleFactor;
        const textY = rowY + iconSize / 2;
        ctx.fillText(stat.label, labelX, textY);
        
        // Draw Value + Unit
        const labelWidth = ctx.measureText(stat.label).width;
        const valueX = labelX + labelWidth + 24 * scaleFactor;
        ctx.fillText(`${stat.value}${stat.unit || ''}`, valueX, textY);

      } else if (isPixel) {
        // --- NEW PINK PIXEL STAT BOX ---
        const assetMap = {
          '聊天对话': 'chats',
          '相伴天数': 'days',
          '聊天字数': 'characters',
          '回忆大小': 'size'
        };
        const assetKey = assetMap[stat.label];
        const statImg = pixelAssets[assetKey];
        
        if (statImg) {
          ctx.drawImage(statImg, boxX, cy, boxW, boxH);
        }

        // 1. Label Positioning (Moved left 10px, up 5px)
        ctx.textAlign = 'left';
        ctx.fillStyle = '#333333';
        ctx.font = `400 ${30 * scaleFactor}px "Cubic 11", sans-serif`;
        ctx.fillText(stat.label, boxX + 50 * scaleFactor, cy + boxH / 2 + 5 * scaleFactor);
        
        // 2. Value Positioning (Inside the dark box on the right, moved up 5px)
        ctx.textAlign = 'right';
        ctx.fillStyle = '#EFFFFF'; // Light blue-ish pixel text
        const valueX = boxX + boxW - 35 * scaleFactor;
        const valueY = cy + boxH / 2 + 5 * scaleFactor;
        
        if (stat.unit) {
          // Draw Unit first at 24px
          ctx.font = `400 ${24 * scaleFactor}px "Cubic 11", sans-serif`;
          ctx.fillText(stat.unit, valueX, valueY);
          
          // Measure and draw Value at 28px
          const unitW = ctx.measureText(stat.unit).width;
          ctx.font = `400 ${28 * scaleFactor}px "Cubic 11", sans-serif`;
          ctx.fillText(stat.value, valueX - unitW - 8 * scaleFactor, valueY);
        } else {
          ctx.font = `400 ${28 * scaleFactor}px "Cubic 11", sans-serif`;
          ctx.fillText(stat.value, valueX, valueY);
        }

      } else {
        // Shadow for Modern Style
        ctx.save();
        ctx.shadowColor = shadowColor;
        ctx.shadowBlur = 24 * scaleFactor;
        ctx.shadowOffsetY = 12 * scaleFactor;
        ctx.fillStyle = statBoxColor;
        roundRect(boxX, cy, boxW, boxH, 24 * scaleFactor);
        ctx.restore();

        // Label
        ctx.textAlign = 'left';
        ctx.fillStyle = statLabelColor;
        ctx.font = `400 ${28 * scaleFactor}px ${baseFontFamily}`; // Reverted to 400
        ctx.fillText(stat.label, boxX + 32 * scaleFactor, cy + boxH / 2 + 8 * scaleFactor);

        // Value & Unit
        ctx.textAlign = 'right';
        const valueX = boxX + boxW - 32 * scaleFactor;

        if (stat.unit) {
          ctx.save();
          ctx.globalAlpha = 0.7; // 70% opacity for units
          ctx.fillStyle = statLabelColor;
          ctx.font = `400 ${24 * scaleFactor}px ${baseFontFamily}`; // Reverted to 400
          ctx.fillText(stat.unit, valueX, cy + boxH / 2 + 8 * scaleFactor);
          ctx.restore();

          const unitWidth = ctx.measureText(stat.unit).width;
          ctx.fillStyle = statValueColor;
          ctx.font = `700 ${28 * scaleFactor}px ${baseFontFamily}`; // Weight Bold
          ctx.fillText(stat.value, valueX - unitWidth - 8 * scaleFactor, cy + boxH / 2 + 8 * scaleFactor);
        } else {
          ctx.fillStyle = statValueColor;
          ctx.font = `700 ${28 * scaleFactor}px ${baseFontFamily}`;
          ctx.fillText(stat.value, valueX, cy + boxH / 2 + 8 * scaleFactor);
        }
      }
    });

    // 7. Decorative Pixel Art (Pixel style only)
    if (isPixel) {
      // Floppy Disk / Decor from asset - Move to absolute bottom-left (0, height)
      const decorImg = pixelAssets.decor;
      if (decorImg) {
        const dw = 120 * scaleFactor;
        const dh = (decorImg.height / decorImg.width) * dw;
        ctx.drawImage(decorImg, 0, height - dh, dw, dh);
      }
    }

    // 7. 绘制底部互动栏 (Ins Style Only)
    if (shareStyle === 'ins') {
      const footerY = height - footerH;
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(0, footerY, width, footerH);

      const iconY = footerY + 30 * scaleFactor;
      const startX = 32 * scaleFactor;
      const iconGap = 20 * scaleFactor; // Adjusted gap for SVG
      const iconSize = 36 * scaleFactor; // Figma size

      function drawPngIcon(path, x, y) {
        if (!path) return;
        ctx.save();
        ctx.translate(x, y);
        const p = new Path2D(path);
        ctx.scale(iconSize / 36, iconSize / 36); // Original paths are 36x36

        // For simple outlines, we stroke them
        if (path === insIcons.heart || path === insIcons.comment || path === insIcons.bookmark || path === insIcons.share) {
          ctx.strokeStyle = '#333333';
          ctx.lineWidth = 3;
          ctx.lineJoin = 'round';
          ctx.lineCap = 'round';
          ctx.stroke(p);
        } else {
          ctx.fillStyle = '#333333';
          ctx.fill(p);
        }
        ctx.restore();
      }

      drawPngIcon(insIcons.heart, startX, iconY);
      drawPngIcon(insIcons.comment, startX + iconSize + iconGap, iconY);
      drawPngIcon(insIcons.share, startX + (iconSize + iconGap) * 2, iconY);
      drawPngIcon(insIcons.bookmark, width - startX - iconSize, iconY);
    }
    } // Close else block for modern/ins/pixel layout

    ctx.restore(); // Restore from card-level 16px clipping
    return canvas.toDataURL('image/png');
  }

  async function generateGlobalShareImage(dataList, tab) {
    if (!dataList || dataList.length === 0) return null;
    
    // 强制等待所有字体加载完毕
    await document.fonts.ready;
    
    // 终极策略：直接从已排版好的标题元素抓取真实计算字体
    const sampleEl = document.querySelector('.ccs-global-title') || document.body;
    const baseFontFamily = getComputedStyle(sampleEl).fontFamily || '"LXGW Neo XiHei", "PingFang SC", sans-serif';
    
    // 取前 5
    const topList = dataList.slice(0, 5);
    
    // Canvas 配置 (增大内部元素的视觉比例)
    const scaleFactor = 2; // Retina 
    const baseWidth = 500;
    const headerHeight = 90;
    const itemHeight = 82; // padding 14*2 + avatar 54
    const spacing = 12; // margin-bottom
    const padding = 24; // modal padding
    
    const baseHeight = headerHeight + topList.length * (itemHeight + spacing) + padding;
    
    const width = baseWidth * scaleFactor;
    const height = baseHeight * scaleFactor;
    
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    
    // 获取当前模态框样式
    const modalEl = document.querySelector('.ccs-global-modal-content');
    const computedStyles = modalEl ? getComputedStyle(modalEl) : null;
    const modalBg = computedStyles ? computedStyles.backgroundColor : 'rgba(0,0,0,0.8)';
    const textColor = computedStyles ? computedStyles.color : '#FFFFFF';
    
    // 背景兜底 (抓取 body 颜色防止全透明长图发黑)
    const bodyBg = getComputedStyle(document.body).backgroundColor || '#2A2D34';
    ctx.fillStyle = bodyBg;
    ctx.fillRect(0, 0, width, height);
    
    // 叠加模态框实际背景
    ctx.fillStyle = modalBg;
    ctx.fillRect(0, 0, width, height);
    
    // Header
    let tabName = '对话总数';
    if (tab === 'days') tabName = '相伴天数';
    if (tab === 'size') tabName = '回忆大小';
    
    const iconEl = document.querySelector('.ccs-global-title-icon');
    const iconColor = iconEl ? getComputedStyle(iconEl).color : textColor;
    
    ctx.fillStyle = iconColor;
    ctx.font = `900 ${24 * scaleFactor}px "Font Awesome 6 Free", "Font Awesome 5 Free", "FontAwesome"`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText('\uf521', padding * scaleFactor, padding * scaleFactor + 25 * scaleFactor);
    
    ctx.fillStyle = textColor;
    ctx.font = `bold ${26 * scaleFactor}px ${baseFontFamily}`;
    ctx.fillText(`${tabName}`, padding * scaleFactor + 34 * scaleFactor, padding * scaleFactor + 25 * scaleFactor);
    
    // Function to draw rounded rect
    function drawRoundedRect(x, y, w, h, r, fillStyle) {
      ctx.beginPath();
      ctx.moveTo(x + r, y);
      ctx.lineTo(x + w - r, y);
      ctx.arcTo(x + w, y, x + w, y + r, r);
      ctx.lineTo(x + w, y + h - r);
      ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
      ctx.lineTo(x + r, y + h);
      ctx.arcTo(x, y + h, x, y + h - r, r);
      ctx.lineTo(x, y + r);
      ctx.arcTo(x, y, x + r, y, r);
      ctx.closePath();
      if (fillStyle) {
        ctx.fillStyle = fillStyle;
        ctx.fill();
      }
    }
    
    // Items
    let currentY = headerHeight * scaleFactor;
    
    // Load avatars
    const avatars = await Promise.all(topList.map(async (stat) => {
      return new Promise((resolve) => {
        const img = new Image();
        img.crossOrigin = 'Anonymous';
        img.onload = () => resolve(img);
        img.onerror = () => {
          const defaultImg = new Image();
          defaultImg.src = '../img/char-default.png';
          defaultImg.onload = () => resolve(defaultImg);
          defaultImg.onerror = () => resolve(null);
        };
        img.src = stat.avatar;
      });
    }));
    
    topList.forEach((stat, index) => {
      const itemX = padding * scaleFactor;
      const itemY = currentY;
      const itemW = width - padding * 2 * scaleFactor;
      const itemH = itemHeight * scaleFactor;
      
      // Card bg (Base + subtle gradient for Top 3)
      let itemBg = 'rgba(128, 128, 128, 0.08)';
      const rankItemExample = document.querySelector('.ccs-rank-item');
      if (rankItemExample) {
        itemBg = getComputedStyle(rankItemExample).backgroundColor;
      }
      
      // Draw Base Background
      drawRoundedRect(itemX, itemY, itemW, itemH, 16 * scaleFactor, itemBg);
      
      // Draw Subtle Gradient Highlight for Top 3 (matching CSS)
      if (index < 3) {
        let gradColor = 'rgba(245, 166, 35, 0.08)'; // Default Top 1
        if (index === 1) gradColor = 'rgba(155, 155, 155, 0.08)';
        if (index === 2) gradColor = 'rgba(192, 124, 65, 0.08)';
        
        ctx.save();
        const sideGrad = ctx.createLinearGradient(itemX, itemY, itemX + itemW, itemY);
        sideGrad.addColorStop(0, gradColor);
        sideGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');
        
        // Clip to the rounded rect used for the card
        ctx.beginPath();
        const r = 16 * scaleFactor;
        ctx.moveTo(itemX + r, itemY);
        ctx.lineTo(itemX + itemW - r, itemY);
        ctx.arcTo(itemX + itemW, itemY, itemX + itemW, itemY + r, r);
        ctx.lineTo(itemX + itemW, itemY + itemH - r);
        ctx.arcTo(itemX + itemW, itemY + itemH, itemX + itemW - r, itemY + itemH, r);
        ctx.lineTo(itemX + r, itemY + itemH);
        ctx.arcTo(itemX, itemY + itemH, itemX, itemY + itemH - r, r);
        ctx.lineTo(itemX, itemY + r);
        ctx.arcTo(itemX, itemY, itemX + r, itemY, r);
        ctx.closePath();
        ctx.clip();
        
        ctx.fillStyle = sideGrad;
        ctx.fillRect(itemX, itemY, itemW, itemH);
        ctx.restore();
      }
      
      // Rank Badge (Circle for top 3, text for rest)
      const badgeSize = 34 * scaleFactor;
      const badgeX = itemX + 14 * scaleFactor; // inner padding 14px
      const badgeY = itemY + (itemH - badgeSize) / 2;
      
      let badgeFontSize = 20; 
      let badgeOffsetX = 0;
      let badgeOffsetY = 1; // minor optical visual tweak
      
      if (index < 3) {
        let badgeColor = 'rgba(128, 128, 128, 0.2)';
        if (index === 0) {
          const grad = ctx.createLinearGradient(badgeX, badgeY, badgeX + badgeSize, badgeY + badgeSize);
          grad.addColorStop(0, '#FFE169');
          grad.addColorStop(1, '#F5A623');
          badgeColor = grad;
          badgeFontSize = 22;
        } else if (index === 1) {
          const grad = ctx.createLinearGradient(badgeX, badgeY, badgeX + badgeSize, badgeY + badgeSize);
          grad.addColorStop(0, '#E2E2E2');
          grad.addColorStop(1, '#9B9B9B');
          badgeColor = grad;
          badgeFontSize = 20;
        } else if (index === 2) {
          const grad = ctx.createLinearGradient(badgeX, badgeY, badgeX + badgeSize, badgeY + badgeSize);
          grad.addColorStop(0, '#F5C695');
          grad.addColorStop(1, '#C07C41');
          badgeColor = grad;
          badgeFontSize = 20;
        }
        
        ctx.beginPath();
        ctx.arc(badgeX + badgeSize/2, badgeY + badgeSize/2, badgeSize/2, 0, Math.PI * 2);
        ctx.fillStyle = badgeColor;
        ctx.fill();
        
        ctx.fillStyle = '#FFFFFF';
        ctx.globalAlpha = 1.0;
      } else {
        ctx.fillStyle = textColor;
        ctx.globalAlpha = 0.5;
        badgeOffsetX = -2 * scaleFactor;
      }
      
      ctx.font = `bold ${badgeFontSize * scaleFactor}px ${baseFontFamily}`;
      ctx.textAlign = 'center';
      // using alphabetic baseline can be more precise for numbers vertically if math is right
      ctx.textBaseline = 'middle';
      ctx.fillText((index + 1).toString(), badgeX + badgeSize/2 + badgeOffsetX, badgeY + badgeSize/2 + badgeOffsetY * scaleFactor);
      ctx.globalAlpha = 1.0;
      
      // Avatar (object-fit cover equivalent)
      const avatarSize = 54 * scaleFactor; // boosted avatar size
      const avatarX = badgeX + badgeSize + 16 * scaleFactor; // margin-right 16px
      const avatarY = itemY + (itemH - avatarSize) / 2;
      
      const img = avatars[index];
      if (img) {
        ctx.save();
        ctx.beginPath();
        ctx.arc(avatarX + avatarSize/2, avatarY + avatarSize/2, avatarSize/2, 0, Math.PI * 2);
        ctx.clip();
        
        let drawW = avatarSize;
        let drawH = avatarSize;
        let offsetX = 0;
        let offsetY = 0;
        
        if (img.width > 0 && img.height > 0) {
          const imgAspect = img.width / img.height;
          if (imgAspect > 1) { // wider
            drawW = avatarSize * imgAspect;
            offsetX = -(drawW - avatarSize) / 2;
          } else { // taller or square
            drawH = avatarSize / imgAspect;
            offsetY = -(drawH - avatarSize) / 2;
          }
        }
        
        ctx.drawImage(img, avatarX + offsetX, avatarY + offsetY, drawW, drawH);
        ctx.restore();
      }
      
      // Text logic
      let valueHtml = '';
      let descHtml = '';
      let unitHtml = '';
      
      if (tab === 'messages') {
        valueHtml = stat.messages.toString();
        unitHtml = '条';
        descHtml = `陪伴 ${stat.days} 天`;
      } else if (tab === 'days') {
        valueHtml = stat.days.toString();
        unitHtml = '天';
        let firstMeetStr = '未知';
        if (stat.firstTimeRaw) {
          const dt = new Date(stat.firstTimeRaw);
          if (!isNaN(dt.getTime())) {
            firstMeetStr = `${dt.getFullYear()}.${Math.floor(dt.getMonth() + 1).toString().padStart(2, '0')}.${Math.floor(dt.getDate()).toString().padStart(2, '0')}`;
          }
        }
        descHtml = `初遇 ${firstMeetStr}`;
      } else if (tab === 'size') {
        const sizeParts = stat.formattedSize.split(' ');
        valueHtml = sizeParts[0] || '0';
        unitHtml = sizeParts[1] || 'B';
        descHtml = `${stat.messages} 条对话`;
      }
      
      // Name
      const textX = avatarX + avatarSize + 16 * scaleFactor;
      ctx.fillStyle = textColor;
      // Name (Increased)
      ctx.font = `bold ${21 * scaleFactor}px ${baseFontFamily}`;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'alphabetic';
      ctx.fillText(stat.name, textX, itemY + itemH/2 - 6 * scaleFactor);
      
      // Desc (Increased)
      ctx.globalAlpha = 0.6;
      ctx.fillStyle = textColor;
      ctx.font = `400 ${16.5 * scaleFactor}px ${baseFontFamily}`;
      ctx.fillText(descHtml, textX, itemY + itemH/2 + 16 * scaleFactor);
      
      // Value & Unit (Balanced proportions)
      const rightPadding = itemW - parseInt(16 * scaleFactor);
      // Unit (Increased slightly from before)
      ctx.font = `400 ${16 * scaleFactor}px ${baseFontFamily}`;
      ctx.textAlign = 'right';
      ctx.textBaseline = 'alphabetic';
      ctx.fillText(unitHtml, itemX + rightPadding, itemY + itemH/2 + 6 * scaleFactor);
      ctx.globalAlpha = 1.0;
      
      const unitWidth = ctx.measureText(unitHtml).width;
      // Value (Decreased slightly to balance with unit)
      ctx.font = `bold ${21 * scaleFactor}px ${baseFontFamily}`;
      ctx.fillText(valueHtml, itemX + rightPadding - unitWidth - 4 * scaleFactor, itemY + itemH/2 + 6 * scaleFactor);
      
      currentY += (itemHeight + spacing) * scaleFactor;
    });
    
    return { dataUrl: canvas.toDataURL('image/png'), filename: `羁绊排行_${tabName}.png` };
  }

  function showPreview(imageData, customFilename) {
    const $modal = $("#ccs-preview-modal");
    const $container = $("#ccs-preview-container");

    // 清空之前的内容
    $container.empty();

    // 创建预览图片
    const img = new Image();
    img.src = imageData;
    img.style.maxWidth = '100%';
    img.style.height = 'auto';
    img.style.borderRadius = '5px';

    // 添加到容器
    $container.append(img);

    // 显示模态框
    $modal.addClass('ccs-modal-visible');
    $('body').addClass('ccs-no-scroll'); // 阻止背景滚动
    
    // Store filename
    $("#ccs-download").data('filename', customFilename || '');
    
    // Hide UI elements not relevant for global share
    if (customFilename && customFilename.includes('排行')) {
      $("#ccs-style-select").hide();
    } else {
      $("#ccs-style-select").show();
    }
  }

  // 添加刷新按钮事件处理
  $("#ccs-refresh").on("click", async function () {
    const $button = $(this);

    // 禁用按钮并显示更新中状态
    $button.prop('disabled', true).val('更新中...');

    try {
      // 更新统计
      await updateStats();

      // 显示更新成功状态
      $button.val('已更新');
    } catch (error) {
      console.error('更新统计数据失败:', error);
      $button.val('更新失败');
    } finally {
      // 恢复按钮状态
      setTimeout(() => {
        $button.prop('disabled', false).val('刷新');
      }, 800);
    }
  });

  $("#ccs-share").on("click", async function () {
    const $button = $(this);
    if ($button.prop('disabled')) return; // 如果按钮被禁用，直接返回

    // 确保同步当前的样式选择
    shareStyle = $("#ccs-style-select").val() || 'modern-light';

    $button.prop('disabled', true).val('生成中...');

    // Show modal in loading state first to give immediate feedback
    const $modal = $("#ccs-preview-modal");
    const $container = $("#ccs-preview-container");
    $container.empty().addClass('loading-preview');
    $modal.addClass('ccs-modal-visible');
    $('body').addClass('ccs-no-scroll'); // 阻止背景滚动

    try {
      const imageData = await generateShareImage();
      // Wait a tiny bit extra just in case
      await new Promise(r => setTimeout(r, 100));
      $container.removeClass('loading-preview');
      const characterName = getCurrentCharacterName();
      showPreview(imageData, `羁绊卡片_${characterName}.png`);
      $button.val('已生成');
    } catch (error) {
      console.error('生成分享图片失败:', error);
      $container.removeClass('loading-preview');
      $container.html('<p style="color:red; padding: 20px;">生成分享图片失败，请检查控制台。</p>');
    } finally {
      setTimeout(() => {
        $button.prop('disabled', false).val('生成卡片');
      }, 1000);
    }
  });

  // 添加取消按钮事件处理
  $("#ccs-cancel").on("click", function () {
    $("#ccs-preview-modal").removeClass('ccs-modal-visible').hide();
    $('body').removeClass('ccs-no-scroll'); // 恢复背景滚动
  });

  // 添加保存按钮事件
  $("#ccs-download").on("click", function () {
    const filename = $(this).data('filename') || '羁绊卡片.png';
    const link = document.createElement('a');
    link.download = filename;
    link.href = $("#ccs-preview-container img").attr('src');
    link.click();
  });

  // 点击模态框背景关闭
  $("#ccs-preview-modal").on("click", function (e) {
    if (e.target === this) {
      $(this).removeClass('ccs-modal-visible').hide();
      $('body').removeClass('ccs-no-scroll'); // 恢复背景滚动
    }
  });

  // Debounced update function
  const debouncedUpdateStats = debounce(updateStats, 500); // 500ms delay

  // 初始化时的基本更新
  updateStats(); // Keep initial update on load

  let lastStyleIndex = -1;
  let explicitSlideDirection = null;

  // 风格切换处理 (在预览窗口中)
  $("#ccs-style-select").on('change', async function () {
    const $select = $(this);
    shareStyle = $select.val();
    localStorage.setItem('ccs-share-style', shareStyle); // 保存用户选择到 localStorage
    if (DEBUG) console.log('Selected style changed (dropdown):', shareStyle);

    const options = $select.find("option");
    const currentIndex = options.index(options.filter(":selected"));
    
    let direction = explicitSlideDirection;
    if (!direction) {
      if (lastStyleIndex !== -1) {
        direction = currentIndex > lastStyleIndex ? 'next' : 'prev';
      } else {
        direction = 'next';
      }
    }
    explicitSlideDirection = null;
    lastStyleIndex = currentIndex;

    // 即时重新生成预览
    const $container = $("#ccs-preview-container");
    const $img = $container.find('img');
    
    // 执行滑出动画
    if ($img.length) {
      const outClass = direction === 'next' ? 'slide-hide-left' : 'slide-hide-right';
      $img.addClass(outClass);
      
      // 等待滑出动画完成 (200ms)
      await new Promise(r => setTimeout(r, 200));
    }

    $container.addClass('loading-preview'); // Optional: visual feedback

    try {
      const imageData = await generateShareImage();
      if ($img.length) {
        // 瞬间重置位置并加载新图片（不执行滑入动画）
        $img.css('transition', 'none');
        $img.removeClass('slide-hide-left slide-hide-right');
        
        // 先设为透明，准备淡入
        $img.css('opacity', '0');
        $img.attr('src', imageData);
        
        // 强制重绘
        $img[0].offsetHeight;
        
        // 恢复动画并淡入
        $img.css('transition', 'opacity 0.3s ease-in-out');
        $img.css('opacity', '1');
        
        // 动画完成后清理内联样式
        setTimeout(() => {
          $img.css('transition', '');
          $img.css('opacity', '');
        }, 300);
      } else {
        // 首屏加载
        $container.find('img').attr('src', imageData);
      }
    } catch (e) {
      console.error('Failed to regenerate preview:', e);
      alert('生成预览失败: ' + e.message);
    } finally {
      $container.removeClass('loading-preview');
    }
    updateCarouselDots();
  });

  // 初始化 Carousel Dots
  function initCarouselDots() {
    const $select = $("#ccs-style-select");
    const options = $select.find("option");
    const $dotsContainer = $("#ccs-carousel-dots");
    $dotsContainer.empty();
    
    options.each(function(index) {
      const $dot = $('<div class="ccs-carousel-dot"></div>');
      $dot.on('click', function(e) {
        e.stopPropagation(); // Prevent modal close
        $select.prop("selectedIndex", index).trigger("change");
      });
      $dotsContainer.append($dot);
    });
    updateCarouselDots();
  }

  function updateCarouselDots() {
    const $select = $("#ccs-style-select");
    const options = $select.find("option");
    const currentIndex = options.index(options.filter(":selected"));
    
    $("#ccs-carousel-dots .ccs-carousel-dot").removeClass("active");
    $("#ccs-carousel-dots .ccs-carousel-dot").eq(currentIndex).addClass("active");
  }
  
  // 仅初始化一次
  initCarouselDots();

  // Carousel 左右切换逻辑
  function cycleStyle(direction) {
    explicitSlideDirection = direction;
    const $select = $("#ccs-style-select");
    const options = $select.find("option");
    let currentIndex = options.index(options.filter(":selected"));
    
    if (direction === 'next') {
      currentIndex = (currentIndex + 1) % options.length;
    } else {
      currentIndex = (currentIndex - 1 + options.length) % options.length;
    }
    
    $select.prop("selectedIndex", currentIndex).trigger("change");
  }

  $("#ccs-carousel-prev").on("click", function() {
    cycleStyle('prev');
  });

  $("#ccs-carousel-next").on("click", function() {
    cycleStyle('next');
  });

  // 支持滑动切换 (Swipe)
  let touchStartX = 0;
  let touchEndX = 0;

  $("#ccs-preview-container").on("touchstart", function(e) {
    touchStartX = e.changedTouches[0].screenX;
  });

  $("#ccs-preview-container").on("touchend", function(e) {
    touchEndX = e.changedTouches[0].screenX;
    handleSwipe();
  });

  function handleSwipe() {
    const threshold = 50; // 最小滑动距离
    if (touchEndX < touchStartX - threshold) {
      // 左滑 -> next
      cycleStyle('next');
    }
    if (touchEndX > touchStartX + threshold) {
      // 右滑 -> prev
      cycleStyle('prev');
    }
  }

  // 绑定点击事件 - 使用事件委托以防动态加载问题
  $(document).on('click', '#ccs-refresh', updateStats);

  // “查看更多”高级统计逻辑
  $(document).on('click', '#ccs-view-more', async function() {
    const $modal = $('#ccs-advanced-modal');
    const $loading = $('#ccs-advanced-loading');
    const $content = $('#ccs-advanced-content');
    const $error = $('#ccs-advanced-error');
    
    // 动态更新模态框标题
    $('#ccs-advanced-character-name').text(`${getCurrentCharacterName()}`);
    
    // 1. 打开模态框并显示加载状态
    $('#ccs-advanced-progress-text').text('正在分析回忆...');
    $('#ccs-advanced-progress-bar').css('width', '0%');
    
    $loading.show();
    $content.hide();
    $error.hide();
    $modal.addClass('ccs-modal-visible').show();
    $('body').addClass('ccs-no-scroll');
    
    try {
      if (DEBUG) console.log("[StatsDebug] View More clicked, triggering deep scan...");
      // 执行深度分析
      await updateStats(true, (percent, current, total) => {
        $('#ccs-advanced-progress-text').text(`正在分析回忆... ${percent}%`);
        $('#ccs-advanced-progress-bar').css('width', `${percent}%`);
      });
      
      if (currentAdvancedStats) {
        $loading.hide();
        $content.fadeIn();
        
        // 填充数据
        $('#ccs-today-messages').html(`${currentAdvancedStats.todayMessages} <span class="ccs-advanced-unit">条</span>`);
        $('#ccs-longest-streak').html(`${currentAdvancedStats.longestStreak} <span class="ccs-advanced-unit">天</span>`);
        $('#ccs-peak-date').text(currentAdvancedStats.peakDate || '--');
        $('#ccs-peak-count').html(`${currentAdvancedStats.peakCount} <span class="ccs-advanced-unit">条消息</span>`);

        // 如果是部分数据，显示温和提示
        if (lastDeepScanPartial) {
          $error.html('部分聊天记录读取超时，当前为不完整统计。点击刷新可重试。').css('color', 'var(--SmartThemeEmColor)').show();
        }
      } else {
        // 即使高级统计为空，尝试显示基础统计信息
        const basicMessages = parseInt($('#ccs-messages').text(), 10) || 0;
        if (basicMessages > 1) {
          $loading.hide();
          // 有基础数据但深度扫描全部失败
          $error.html('聊天记录数据量较大，详细统计读取失败。<br>这不影响基础统计功能，请稍后再试。').show();
        } else {
          $loading.hide();
          $error.html('当前没有足够的互动数据来计算详细统计。').show();
        }
      }
    } catch (e) {
      if (DEBUG) console.error("[StatsDebug] Deep scan failed:", e);
      $loading.hide();
      $error.html('分析过程出现异常，请稍后再试。').show();
    }
  });

  $("#ccs-advanced-close").on('click', function() {
    $('#ccs-advanced-modal').removeClass('ccs-modal-visible').hide();
    $('body').removeClass('ccs-no-scroll');
    currentAdvancedStats = null; // Memory release
  });

  // 点击背景关闭高级统计
  $("#ccs-advanced-modal").on('click', function(e) {
    if (e.target === this) {
      $(this).removeClass('ccs-modal-visible').hide();
      $('body').removeClass('ccs-no-scroll');
      currentAdvancedStats = null; // Memory release
    }
  });

  // Add change listener to checkboxes to update share button state
  $(document).on('change', '.ccs-share-option input[type="checkbox"]', function () {
    // Re-evaluate button state based on current message count whenever options change
    const currentMessageCount = parseInt($("#ccs-messages").text(), 10) || 0;
    updateActionButtonsState(currentMessageCount);
  });

  // Observe character selection changes to trigger auto-refresh
  const selectedCharObserver = new MutationObserver((mutationsList) => {
    // Check if the mutations likely indicate a character change
    // A simple check is often enough, but could be refined if needed
    for (const mutation of mutationsList) {
      if (mutation.type === 'childList' || mutation.type === 'characterData') {
        if (DEBUG) console.log('Selected character change observed, triggering debounced update...');
        debouncedUpdateStats();
        return; // Only need to trigger once per batch of mutations
      }
    }
  });

  // Find the target element to observe - #rm_button_selected_ch seems appropriate
  const selectedCharElement = document.getElementById("rm_button_selected_ch");
  if (selectedCharElement) {
    if (DEBUG) console.log('Observing #rm_button_selected_ch for mutations.');
    // Observe changes to the children and subtree (like the h2 text changing)
    selectedCharObserver.observe(selectedCharElement, {
      childList: true,
      subtree: true,
      characterData: true // Observe text changes directly within nodes
    });
  } else {
    console.error('#rm_button_selected_ch element not found for MutationObserver.');
  }


  // // 定期更新 (Removed interval-based update)
  // setInterval(updateStats, 30000);

  // =========================================================================
  // 全局羁绊排行 (Global Leaderboard) 逻辑
  // 设计核心：极速提取元数据，零全局变量，阅后即焚（极致省内存）
  // =========================================================================

  async function fetchAllCharactersStats() {
    console.log("--- DEBUG GLOBAL STATS ---");
    const context = getContext();
    console.log("Context from getContext():", context);
    
    // We need to hunt down the characters array in SillyTavern global scope.
    let charsSource = context.characters || window.characters || window.characters_data;
    console.log("Initial charsSource:", charsSource);

    // Some versions of ST keep characters in localstorage or need it fetched differently, 
    // but window.characters is the standard since 1.X. Let's inspect window keys.
    if (!charsSource) {
      console.warn("Could not find standard characters object. Listing window keys with 'char':");
      const charKeys = Object.keys(window).filter(k => k.toLowerCase().includes('char'));
      console.log(charKeys);
      return [];
    }
    
    // DEBUG: Understand how getPastCharacterChats works internally in ST
    console.log("getPastCharacterChats signature:", getPastCharacterChats.toString());

    // 使用 entries 来保留角色的原始 ID (Key 或数组 Index)
    const charsEntries = Object.entries(charsSource);
    console.log("Parsed charsEntries length:", charsEntries.length);
    console.log("First character item sample:", charsEntries[0]);

    if (charsEntries.length === 0) {
      if (DEBUG) console.warn("Characters array is empty.");
      return [];
    }

    const statsList = [];
    const now = new Date();
    const utcNow = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());

    // Fetch sequentially to prevent hitting ST server concurrency limits or deadlocks
    const $spinner = $('#ccs-global-spinner');
    const totalChars = charsEntries.length;

    for (let i = 0; i < totalChars; i++) {
        const [charId, char] = charsEntries[i];
        
        if ($spinner.length) {
            $spinner.html(`<i class="fa-solid fa-spinner fa-spin"></i> 正在读取回忆... (${i + 1}/${totalChars})`);
        }

        // Skip default/empty characters
        if (!char || !char.avatar) {
            console.log(`[GlobalStats] Skipping index ${charId} - missing avatar.`);
            continue;
        }

        try {
          if (DEBUG) console.log(`[GlobalStats] [${i+1}/${totalChars}] Fetching chats for ${char.name} (ID: ${charId})`);
          // 致命 Bug 修复：SillyTavern 原生 API 接受的是 characterId (即在 characters 数组里的 Index/Key)
          let chats = await getPastCharacterChats(charId);
          
          // --- 【增强】如果 index 找不到，尝试直接用 avatar 名字 ---
          if (!chats || chats.length === 0) {
              if (DEBUG) console.log(`[GlobalStats] => Index ${charId} returned no chats, trying avatar: ${char.avatar}`);
              chats = await getPastCharacterChats(char.avatar);
          }

          if (!chats || chats.length === 0) {
              if (DEBUG) console.log(`[GlobalStats] => No chats found for: ${char.name}`);
              continue;
          }
          console.log(`[GlobalStats] => Found ${chats.length} chat items for: ${char.name}`, chats);

          let totalMessages = 0;
          let totalSizeBytesRaw = 0;
          let earliestTime = null;
          let hasInteraction = false;
          let parseableFilesInfo = [];
          let unparseableFiles = [];

          chats.forEach(chat => {
            // Count messages
            const itemsCount = parseInt(chat.chat_items) || 0;
            totalMessages += itemsCount;

            // Calculate size
            let sizeBytes = 0;
            const sizeMatchKB = chat.file_size?.match(/([\d.]+)\s*KB/i);
            const sizeMatchMB = chat.file_size?.match(/([\d.]+)\s*MB/i);
            const sizeAsNumber = parseFloat(chat.file_size);

            if (sizeMatchMB) {
              sizeBytes = parseFloat(sizeMatchMB[1]) * 1024 * 1024;
            } else if (sizeMatchKB) {
              sizeBytes = parseFloat(sizeMatchKB[1]) * 1024;
            } else if (!isNaN(sizeAsNumber)) {
              sizeBytes = sizeAsNumber;
            }
            
            totalSizeBytesRaw += sizeBytes;

            // 严格的互动认定
            if (itemsCount > 1 || (itemsCount === 0 && sizeBytes > 5 * 1024)) {
                hasInteraction = true;
            }

            // Find earliest date
            if (chat.file_name) {
              const timeInfo = parseTimeFromFilename(chat.file_name);
              if (timeInfo && timeInfo.dateObject) {
                parseableFilesInfo.push({ name: chat.file_name, date: timeInfo.dateObject });
                if (!earliestTime || timeInfo.dateObject < earliestTime) {
                  earliestTime = timeInfo.dateObject;
                }
              } else {
                unparseableFiles.push(chat.file_name);
              }
            }
          });

          // Only include characters with actual interaction
          if (!hasInteraction) {
             console.log(`[GlobalStats] => No real interactions for ${char.name}, skipping.`);
             continue;
          }

          // 全局排行：运用精准打击与缓存共享策略统一时间
          // 关键修复：API 调用必须使用 char.avatar（如 "character.png"）而非 charId（数组索引 "0","1"...）
          // 否则 /api/chats/get 无法定位正确的聊天文件目录，导致改名文件的初遇时间丢失
          const avatarForApi = char.avatar;
          if (accurateEncounterTimeCache[avatarForApi]) {
             earliestTime = accurateEncounterTimeCache[avatarForApi];
          } else {
             parseableFilesInfo.sort((a,b) => a.date - b.date);
             // 全局扫描：对最老的2个可解析文件进行完整统计
             let filesToCheck = parseableFilesInfo.slice(0, 2).map(f => f.name); 

             if (filesToCheck.length > 0) {
               for (const file of filesToCheck) {
                  const fileStats = await getChatFileStats(file, avatarForApi, char.name);
                  if (fileStats && fileStats.earliestTime) {
                     if (!earliestTime || fileStats.earliestTime < earliestTime) {
                        earliestTime = fileStats.earliestTime;
                     }
                  }
               }
             }

             // 对所有被改名的文件，使用轻量API检查第一条消息日期
             if (unparseableFiles.length > 0) {
               for (const file of unparseableFiles) {
                  const msgDate = await getEarliestMessageDate(file, avatarForApi, char.name);
                  if (msgDate) {
                     if (!earliestTime || msgDate < earliestTime) {
                        earliestTime = msgDate;
                     }
                  }
               }
             }

             if (earliestTime) accurateEncounterTimeCache[avatarForApi] = earliestTime;
          }

          let days = 0;
          if (earliestTime) {
            const firstTimeDate = earliestTime instanceof Date ? earliestTime : new Date(earliestTime);
            if (!isNaN(firstTimeDate.getTime())) {
              const utcFirstTime = Date.UTC(firstTimeDate.getFullYear(), firstTimeDate.getMonth(), firstTimeDate.getDate());
              const diffTime = Math.abs(utcNow - utcFirstTime);
              days = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1;
            }
          }

          let formattedSize = '0 B';
          if (totalSizeBytesRaw > 0) {
            const kb = totalSizeBytesRaw / 1024;
            const mb = kb / 1024;
            if (mb >= 1) formattedSize = `${mb.toFixed(2)} MB`;
            else if (kb >= 1) formattedSize = `${kb.toFixed(2)} KB`;
            else formattedSize = `${Math.round(totalSizeBytesRaw)} B`;
          }

          statsList.push({
            name: char.name || '未知角色',
            avatar: `/characters/${char.avatar}`,
            messages: totalMessages,
            days: days,
            sizeRaw: totalSizeBytesRaw,
            formattedSize: formattedSize,
            firstTimeRaw: earliestTime
          });

        } catch (err) {
          if (DEBUG) console.error(`Error fetching stats for char ${char.name}:`, err);
        }
    }

    return statsList;
  }

  function renderGlobalStats(dataList, tab) {
    const $list = $('#ccs-global-list');
    const $shareBtn = $('#ccs-global-share-btn');
    $list.empty(); // 防重叠，并清空旧 DOM 辅助 GC
    $list.scrollTop(0); // 切换 Tab 时重置滚动条

    if (!dataList || dataList.length === 0) {
      $list.html('<div style="text-align: center; padding: 40px; opacity: 0.6;">暂无羁绊数据</div>');
      $shareBtn.addClass('disabled').attr('title', '数据不足，无法生成排行榜');
      return;
    }
    
    if (dataList.length <= 1) {
      $shareBtn.addClass('disabled').attr('title', '数据不足，无法生成排行榜');
    } else {
      $shareBtn.removeClass('disabled').removeAttr('title');
    }

    // 根据 Tab 类型排序
    dataList.sort((a, b) => {
      if (tab === 'messages') return b.messages - a.messages;
      if (tab === 'days') return b.days - a.days;
      if (tab === 'size') return b.sizeRaw - a.sizeRaw;
      return 0;
    });

    const htmlFragments = dataList.map((stat, index) => {
      const topClass = index < 3 ? `top-${index + 1}` : '';
      let valueHtml = '';
      let descHtml = '';
      
      if (tab === 'messages') {
        valueHtml = `${stat.messages} <span style="font-size: 0.8em; opacity: 0.7;">条</span>`;
        descHtml = `陪伴 ${stat.days} 天`;
      } else if (tab === 'days') {
        valueHtml = `${stat.days} <span style="font-size: 0.8em; opacity: 0.7;">天</span>`;
        // Format firstTime to YYYY.MM.DD
        let firstMeetStr = '未知';
        if (stat.firstTimeRaw) {
          const dt = new Date(stat.firstTimeRaw);
          if (!isNaN(dt.getTime())) {
            firstMeetStr = `${dt.getFullYear()}.${Math.floor(dt.getMonth() + 1).toString().padStart(2, '0')}.${Math.floor(dt.getDate()).toString().padStart(2, '0')}`;
          }
        }
        descHtml = `初遇 ${firstMeetStr}`;
      } else if (tab === 'size') {
        // Extract the number and the unit from stat.formattedSize (e.g., "1.23 MB" -> "1.23", "MB")
        const sizeParts = stat.formattedSize.split(' ');
        const numericVal = sizeParts[0] || '0';
        const unitVal = sizeParts[1] || 'B';
        valueHtml = `${numericVal} <span style="font-size: 0.8em; opacity: 0.7;">${unitVal}</span>`;
        descHtml = `${stat.messages} 条对话`;
      }

      return `
        <div class="ccs-rank-item ${topClass}">
          <div class="ccs-rank-number">${index + 1}</div>
          <img class="ccs-rank-avatar" src="${stat.avatar}" onerror="this.src='../img/char-default.png'" />
          <div class="ccs-rank-info">
            <div class="ccs-rank-name">${stat.name}</div>
            <div class="ccs-rank-desc">${descHtml}</div>
          </div>
          <div class="ccs-rank-value">${valueHtml}</div>
        </div>
      `;
    });

    $list.html(htmlFragments.join(''));
  }

  // 绑定“全局羁绊”打开事件
  $(document).on('click', '#ccs-global-stats', async function () {
    const $modal = $('#ccs-global-modal');
    const $spinner = $('#ccs-global-spinner');
    const $list = $('#ccs-global-list');
    
    // 初始化 UI
    $('.ccs-tab').removeClass('active');
    $('.ccs-tab[data-tab="messages"]').addClass('active'); // 默认选中"对话总数"
    $list.empty();
    $spinner.show();
    $modal.addClass('ccs-modal-visible');
    $('body').addClass('ccs-no-scroll'); // 阻止背景滚动

    // 获取数据（无全局缓存记录）
    const statsData = await fetchAllCharactersStats();
    
    // 极短时间把数据挂载在 DOM 自身属性上供切 Tab 时使用
    // 这样当 DOM 被释放时，数据也能被 GC 自动清扫
    $modal.data('tempStatsData', statsData);

    $spinner.hide();
    renderGlobalStats(statsData, 'messages');
  });

  // 绑定 Tab 切换事件
  $("#ccs-global-modal").on('click', '.ccs-tab', function () {
    if ($(this).hasClass('active')) return;
    
    $('.ccs-tab').removeClass('active');
    $(this).addClass('active');
    
    const targetTab = $(this).data('tab');
    const statsData = $('#ccs-global-modal').data('tempStatsData');
    
    if (statsData) {
      renderGlobalStats(statsData, targetTab);
    }
  });

  // 绑定全局排行分享按钮事件
  $("#ccs-global-modal").on('click', '#ccs-global-share-btn', async function () {
    const $button = $(this);
    if ($button.hasClass('loading') || $button.hasClass('disabled')) return;
    
    const targetTab = $('.ccs-tab.active').data('tab');
    const statsData = $('#ccs-global-modal').data('tempStatsData');
    if (!statsData || statsData.length === 0) return;
    
    $button.addClass('loading').css('opacity', '0.5');
    
    // 打开预览模块，并清空容器
    const $modal = $("#ccs-preview-modal");
    const $container = $("#ccs-preview-container");
    $container.empty().addClass('loading-preview');
    $modal.addClass('ccs-modal-visible');
    $('body').addClass('ccs-no-scroll');
    
    try {
      const result = await generateGlobalShareImage(statsData, targetTab);
      if (result) {
        $container.removeClass('loading-preview');
        showPreview(result.dataUrl, result.filename);
      }
    } catch (e) {
      console.error('Failed to generate global share image:', e);
      $container.removeClass('loading-preview');
      $container.html('<p style="color:red; padding: 20px;">生成分享图片失败，请检查控制台。</p>');
    } finally {
      $button.removeClass('loading').css('opacity', '');
    }
  });

  // 绑定关闭事件与内存释放（Garbage Collection Optimization）
  function closeAndClearGlobalModal() {
    const $modal = $('#ccs-global-modal');
    $('body').removeClass('ccs-no-scroll'); // 恢复背景滚动
    $modal.removeClass('ccs-modal-visible').hide();
    // 隐藏动画移除，因为使用了 !important class，jQuery fadeOut 会被复盖
    // 直接操作 class 或用回原来的逻辑并发处理
  }

  $("#ccs-global-close").on('click', closeAndClearGlobalModal);
  
  // 点击遮罩层空白处关闭
  $("#ccs-global-modal").on('click', function (e) {
    if (e.target === this) {
      closeAndClearGlobalModal();
    }
  });

  // =========================================================================

  if (DEBUG) console.log("✅ 聊天陪伴统计插件已加载 (自动刷新已启用)");
  
  // 初始刷新
  setTimeout(updateStats, 1000);
});
