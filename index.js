import { getContext } from "../../../extensions.js";
import { getPastCharacterChats } from '../../../../script.js';

const extensionName = "chat-companion-stats";
const extensionWebPath = import.meta.url.replace(/\/index\.js$/, '');
const DEBUG = true;

jQuery(async () => {
  // 加载CSS文件 using dynamic path
  $('head').append(`<link rel="stylesheet" type="text/css" href="${extensionWebPath}/styles.css">`);

  // 加载自定义字体 (Added handwritten and PING FANG SHAO HUA font)
  $('head').append(`<style>
    @import url("https://fontsapi.zeoseven.com/19/main/result.css");
    @import url("https://fontsapi.zeoseven.com/157/main/result.css");
    @import url("https://fonts.googleapis.com/css2?family=DotGothic16&family=Long+Cang&display=swap");
    
    #ccs-preview-container.loading-preview {
      position: relative;
      min-height: 200px;
    }
    #ccs-preview-container.loading-preview::after {
      content: "正在生成卡片...";
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background: rgba(255, 255, 255, 0.8);
      display: flex;
      justify-content: center;
      align-items: center;
      font-size: 16px;
      color: #333;
      border-radius: 5px;
      z-index: 10;
    }
  </style>`);

  let shareStyle = 'modern-light';

  // 加载HTML using dynamic path with cache buster
  const settingsHtml = await $.get(`${extensionWebPath}/settings.html?v=${Date.now()}`);
  $("#extensions_settings").append(settingsHtml);

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

  // 计算消息的字数 (核心过滤逻辑)
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

  // 构建针对特定路径的 fetch 请求
  async function fetchChatFile(path) {
    try {
      if (DEBUG) console.log(`Attempting fetch: ${path}`);
      const response = await fetch(path, { credentials: 'same-origin' });
      if (response.ok) {
        return await response.text();
      }
      if (DEBUG) console.warn(`Fetch failed for ${path}: ${response.status}`);
    } catch (e) {
      if (DEBUG) console.error(`Fetch error for ${path}:`, e);
    }
    return null;
  }

  // 获取单个聊天文件的统计数据 (带有路径回退逻辑)
  async function getChatFileStats(fileName) {
    const context = getContext();
    const charId = context.characterId;
    const encodedFileName = encodeURIComponent(fileName);
    let text = null;

    // 尝试方式 1: 基于 characterId (头像文件名)
    if (charId && typeof charId === 'string' && charId !== '0') {
      const lastDotIndex = charId.lastIndexOf('.');
      const folderName = lastDotIndex > 0 ? charId.substring(0, lastDotIndex) : charId;
      text = await fetchChatFile(`/chats/${folderName}/${encodedFileName}`);
    }

    // 尝试方式 2: 基于角色名 (从文件名解析)
    if (!text) {
      const characterName = fileName.split(' - ')[0];
      text = await fetchChatFile(`/chats/${encodeURIComponent(characterName)}/${encodedFileName}`);
    }

    if (!text) return { words: 0, count: 0, userCount: 0, earliestUserTime: null };

    try {
      const lines = text.trim().split('\n').filter(l => l.trim());
      let totalWords = 0;
      let validMessages = 0;
      let userMessages = 0;
      let earliestUserTimeInFile = null;

      lines.forEach(line => {
        try {
          const m = JSON.parse(line);
          // 确保是有效的消息对象
          if (m && (m.mes !== undefined || m.is_user !== undefined)) {
            totalWords += countWordsInMessage(m.mes || '');
            validMessages++;

            // 统计用户消息数并提取最早的用户时间
            if (m.is_user === true) {
              userMessages++;
              if (m.send_date) {
                const msgDate = parseSillyTavernDate(m.send_date);
                if (msgDate && (!earliestUserTimeInFile || msgDate < earliestUserTimeInFile)) {
                  earliestUserTimeInFile = msgDate;
                }
              }
            }
          }
        } catch (e) { }
      });

      return {
        words: totalWords,
        count: validMessages,
        userCount: userMessages,
        earliestTime: earliestUserTimeInFile
      };
    } catch (e) {
      if (DEBUG) console.error(`Parsing error for chat ${fileName}:`, e);
      return { words: 0, count: 0, userCount: 0, earliestTime: null };
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
  async function getFullStats() {
    const context = getContext();
    // 兼容不同版本的 SillyTavern 字段名
    let characterId = context.characterId || context.character_id;

    if (DEBUG) console.log('Current Context:', context);

    if (!characterId) {
      if (DEBUG) console.log('未从 context 找到角色ID, 尝试从 DOM/全局变量获取');
      // 尝试从全局变量获取 (SillyTavern 常用变量)
      if (typeof window.selected_character !== 'undefined' && window.characters && window.characters[window.selected_character]) {
        characterId = window.characters[window.selected_character].avatar;
      }
    }

    if (!characterId) {
      if (DEBUG) console.log('仍然未找到当前角色ID');
      return {
        messageCount: 0,
        wordCount: 0,
        firstTime: null,
        totalDuration: 0,
        totalSizeBytes: 0,
        chatFilesCount: 0
      };
    }

    try {
      const chats = await getPastCharacterChats(characterId);
      if (DEBUG) console.log(`获取到 ${characterId} 的聊天记录:`, chats);

      let totalMessagesFromChats = 0;
      let totalSizeKB = 0;
      let earliestTime = null;
      let totalDurationSeconds = 0;
      let totalSizeBytesRaw = 0;
      let maxMessagesInSingleChat = 0;
      const chatFilesCount = Array.isArray(chats) ? chats.length : 0;

      if (chatFilesCount === 0) {
        if (DEBUG) console.log('该角色尚无历史聊天记录');
        return {
          messageCount: 0,
          wordCount: 0,
          firstTime: null,
          totalDuration: 0,
          totalSizeBytes: 0,
          chatFilesCount: 0
        };
      }

      chats.forEach(chat => {
        // 使用元数据作为基础值
        const chatItems = parseInt(chat.chat_items) || 0;
        totalMessagesFromChats += chatItems;
        if (chatItems > maxMessagesInSingleChat) {
          maxMessagesInSingleChat = chatItems;
        }

        // 解析文件大小
        const sizeMatchKB = chat.file_size?.match(/([\d.]+)\s*KB/i);
        const sizeMatchMB = chat.file_size?.match(/([\d.]+)\s*MB/i);
        const sizeAsNumber = parseFloat(chat.file_size);

        if (sizeMatchMB) {
          totalSizeBytesRaw += parseFloat(sizeMatchMB[1]) * 1024 * 1024;
          totalSizeKB += parseFloat(sizeMatchMB[1]) * 1024;
        } else if (sizeMatchKB) {
          totalSizeBytesRaw += parseFloat(sizeMatchKB[1]) * 1024;
          totalSizeKB += parseFloat(sizeMatchKB[1]);
        } else if (!isNaN(sizeAsNumber)) {
          totalSizeBytesRaw += sizeAsNumber;
          totalSizeKB += sizeAsNumber / 1024;
        }

        // 积累时长 & 获取文件名作为初遇时间的参考（通常是文件创建时间）
        if (chat.file_name) {
          const timeInfo = parseTimeFromFilename(chat.file_name);
          if (timeInfo) {
            totalDurationSeconds += timeInfo.totalSeconds;
            // 文件名中的日期通常是该聊天的创建日期，很有参考价值
            if (timeInfo.dateObject && (!earliestTime || timeInfo.dateObject < earliestTime)) {
              earliestTime = timeInfo.dateObject;
              if (DEBUG) console.log('Based on filename, updated earliestTime to:', earliestTime);
            }
          }
        }

        // 解析初遇时间 (作为保底，metadata 通常记录的是文件的最后一条消息时间)
        if (chat.last_mes) {
          const date = parseSillyTavernDate(chat.last_mes);
          if (date && (!earliestTime || date < earliestTime)) {
            // 只有在没更好的数据时才用这个，或者这个确实更早
            earliestTime = date;
          }
        }
      });

      // 默认先使用估算值 (密度取 32.5)
      let estimatedWords = Math.round(totalSizeKB * 32.5);

      // 【性能保护】如果聊天过记录总文件过大，直接跳过全量真实解析防止浏览器崩溃/卡死
      if (totalSizeKB > 10240) { // > 10MB
        if (DEBUG) console.log(`[Performance Check] 体积过大(${totalSizeKB.toFixed(2)}KB)，启用「高速估算模式」以保护内存。`);
        return {
          messageCount: totalMessagesFromChats,
          wordCount: estimatedWords,
          firstTime: earliestTime,
          totalDuration: totalDurationSeconds,
          totalSizeBytes: totalSizeBytesRaw,
          chatFilesCount
        };
      }

      // 尝试进行真实全量统计 (仅在数据量适中时)
      try {
        let totalWordsCalculated = 0;
        let totalMessagesCalculated = 0;
        let totalUserMessagesCalculated = 0;
        let maxMessagesInScan = 0;
        let absoluteEarliestUserTime = null;
        let successCount = 0;

        const batchSize = 10;
        for (let i = 0; i < chats.length; i += batchSize) {
          const batch = chats.slice(i, i + batchSize);
          const results = await Promise.all(batch.map(chat => getChatFileStats(chat.file_name)));

          results.forEach(res => {
            if (res.count > 0 || res.words > 0) {
              totalWordsCalculated += res.words;
              totalMessagesCalculated += res.count;
              totalUserMessagesCalculated += (res.userCount || 0);
              successCount++;

              // 记录分析到的最大单次对话消息数
              if (res.count > maxMessagesInScan) {
                maxMessagesInScan = res.count;
              }

              // 寻找绝对最早的 *用户* 初遇时间
              if (res.earliestTime && (!absoluteEarliestUserTime || res.earliestTime < absoluteEarliestUserTime)) {
                absoluteEarliestUserTime = res.earliestTime;
              }
            }
          });
        }

        // 如果成功获取到了任何实际数据，以实测数据为准
        if (successCount > 0) {
          // 判定逻辑：必须至少有一条用户消息，且不能所有聊天都只有1条开场白 (以实测 count 为准)
          if (totalUserMessagesCalculated === 0 || maxMessagesInScan <= 1) {
            if (DEBUG) console.log(`判定为尚未互动: 用户发言=${totalUserMessagesCalculated}, 最大单场消息=${maxMessagesInScan}`);
            return {
              messageCount: 0,
              wordCount: 0,
              firstTime: null,
              totalDuration: 0,
              totalSizeBytes: totalSizeBytesRaw,
              chatFilesCount
            };
          }

          if (DEBUG) console.log(`全量真实统计成功: ${totalWordsCalculated} 字, 包含 ${totalUserMessagesCalculated} 条用户消息`);

          return {
            messageCount: totalMessagesCalculated,
            wordCount: totalWordsCalculated,
            firstTime: absoluteEarliestUserTime,
            totalDuration: totalDurationSeconds,
            totalSizeBytes: totalSizeBytesRaw,
            chatFilesCount
          };
        }
      } catch (sumError) {
        if (DEBUG) console.error('全量统计过程出错:', sumError);
      }

      // 回退逻辑 (如果全量统计失败，且元数据也没有显示任何有实质内容的会话)
      if (maxMessagesInSingleChat <= 1) {
        return {
          messageCount: 0,
          wordCount: 0,
          firstTime: null,
          totalDuration: 0,
          totalSizeBytes: totalSizeBytesRaw,
          chatFilesCount
        };
      }

      return {
        messageCount: totalMessagesFromChats,
        wordCount: estimatedWords,
        firstTime: earliestTime,
        totalDuration: totalDurationSeconds,
        totalSizeBytes: totalSizeBytesRaw,
        chatFilesCount
      };
    } catch (error) {
      if (DEBUG) console.error('getFullStats 运行出错:', error);
      return {
        messageCount: 0,
        wordCount: 0,
        firstTime: null,
        totalDuration: 0,
        totalSizeBytes: 0,
        chatFilesCount: 0
      };
    }
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
  function updateShareButtonState(messageCount) {
    const $shareButton = $("#ccs-share");

    // Priority Check: Disable if total message count is 1 or less
    if (messageCount <= 1) {
      $shareButton.prop('disabled', true).val('尚未互动');
      if (DEBUG) console.log('updateShareButtonState: Disabled (messageCount <= 1)');
      return;
    }

    // If interaction exists (messageCount > 1), check if options are selected
    const anyOptionChecked = $('.ccs-share-option input[type="checkbox"]:checked').length > 0;

    if (anyOptionChecked) {
      $shareButton.prop('disabled', false).val('分享');
      if (DEBUG) console.log('updateShareButtonState: Enabled (options checked)');
    } else {
      $shareButton.prop('disabled', true).val('请选择内容');
      if (DEBUG) console.log('updateShareButtonState: Disabled (no options checked)');
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

  async function updateStats() {
    if (DEBUG) console.log('Attempting to update stats...');
    const characterName = getCurrentCharacterName();
    $("#ccs-character").text(characterName);
    try {
      const stats = await getFullStats();
      if (DEBUG) console.log('Stats received in updateStats:', stats);

      const chatFilesCount = stats.chatFilesCount || 0;

      // 始终显示字数估算提示
      $("#ccs-tip").show();

      if (!stats.firstTime) {
        if (DEBUG) console.log('No firstTime found in stats, zeroing UI');
        $("#ccs-messages").text("0");
        $("#ccs-words").text("0");
        $("#ccs-total-size").text("0 B");
        $("#ccs-start").text("尚未互动");
        $("#ccs-days").text("0");
        updateShareButtonState(0);
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
        // Pass messageCount to the state function
        updateShareButtonState(stats.messageCount);
      }
      // Removed the stray 'else' block that was here


      if (DEBUG) {
        console.log('Stats UI updated:', {
          messages: stats.messageCount,
          words: stats.wordCount,
          firstTime: stats.firstTime,
          days: $("#ccs-days").text()
        });
      }

    } catch (error) {
      console.error('更新统计数据失败:', error);
      // 显示错误状态
      $("#ccs-messages").text('--');
      $("#ccs-words").text('--');
      $("#ccs-start").text('--');
      $("#ccs-days").text('--');
      $("#ccs-total-size").text('--'); // Clear size on error too
      updateShareButtonState(0); // Pass 0 on error to ensure disabled state
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

  async function generateShareImage() {
    const canvas = document.getElementById('ccs-canvas');
    const ctx = canvas.getContext('2d');
    const charName = getCurrentCharacterName();

    const scaleFactor = 2;
    const width = 663 * scaleFactor;

    // Theme colors
    const isDark = shareStyle === 'modern-dark' || shareStyle === 'dark';
    const isPixel = shareStyle === 'pixel-pink';
    const isModern = shareStyle.startsWith('modern-');

    console.log(`[Pink Pixel Debug] Generating image. shareStyle=${shareStyle}, isPixel=${isPixel}, charName=${charName}`);

    const tealColor = isDark ? '#2F3033' : (isPixel ? '#FFD1DC' : '#F7F9FB');
    const cardBgColor = isDark ? '#2F3033' : (isPixel ? '#FFD1DC' : '#F7F9FB');
    const contentAreaBg = isDark ? '#1C1D1E' : (isPixel ? '#FFFFFF' : '#EFF2F4');
    const statBoxColor = isDark ? '#2F3033' : (isPixel ? '#FFCFD9' : '#F7F9FB');
    const shadowColor = isDark ? 'rgba(19, 19, 19, 0.6)' : (isPixel ? '#000000' : 'rgba(218, 227, 232, 0.6)');

    const statLabelColor = isDark ? '#FAFBF7' : (isPixel ? '#B34E6C' : '#131313');
    const statValueColor = isDark ? '#FAFBF7' : (isPixel ? '#B34E6C' : '#131313');
    const charNameColor = isDark ? '#FAFBF7' : (isPixel ? '#B34E6C' : '#131313');
    const dashColor = isPixel ? '#FF9EB5' : '#FFFFFF';

    // 0. 加载 Ins 风格专属资源 (Now only Background PNG)
    const insAssets = {};
    if (shareStyle === 'ins') {
      if (DEBUG) console.log('Loading ins background...');
      const v = Date.now();
      const assetList = {
        bg: `${extensionWebPath}/assets/mesh-bg.svg?v=${v}`
      };

      const loadAssetImg = (url) => new Promise((resolve) => {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        const timeout = setTimeout(() => {
          console.warn(`Asset load timeout: ${url}`);
          resolve(null);
        }, 3000);
        img.onload = () => { clearTimeout(timeout); resolve(img); };
        img.onerror = () => { clearTimeout(timeout); resolve(null); };
        img.src = url;
      });

      await Promise.all(Object.entries(assetList).map(async ([key, url]) => {
        insAssets[key] = await loadAssetImg(url);
        if (DEBUG && !insAssets[key]) console.warn(`Failed to load asset: ${key} (${url})`);
      }));
      if (DEBUG) console.log('Ins background loaded status:', !!insAssets.bg);
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

    // 如果不是现代简约风且不是像素风，则加上初遇时间显示
    if (!isModern && !isPixel) {
      statsItems.unshift({ id: 'ccs-share-start', label: '初遇时间', value: $("#ccs-start").text().replace(/点/g, ':').replace(/分/g, '') });
    }

    const stats = statsItems.filter(s => $(`#${s.id}`).is(":checked"));

    // 2. 计算动态高度
    const headerH = (shareStyle === 'ins' ? 144 : 214) * scaleFactor;
    const footerH = (shareStyle === 'ins' ? 92 : 48) * scaleFactor;
    const boxH = 80 * scaleFactor;
    const boxGap = (shareStyle === 'ins' ? 24 : 32) * scaleFactor;

    // Ins style: fixed height for content area vs others
    const totalStatsH = (shareStyle === 'ins')
      ? (500 * scaleFactor) // Fixed height for ins content
      : (stats.length > 0 ? (stats.length * boxH + (stats.length - 1) * boxGap + 80 * scaleFactor) : 0);

    const height = headerH + totalStatsH + footerH + (isPixel ? 20 * scaleFactor : 0);
    const dynamicHeight = height;

    // 现代版底色区域 (This block is now mostly for non-ins styles)
    const contentAreaMargin = 32 * scaleFactor;
    const contentAreaW = isModern ? 599 * scaleFactor : (540 * scaleFactor);
    // const contentAreaH = hasStats ? (statsAreaH + 80 * scaleFactor) : 0; // Padding inside content (now totalStatsH)

    canvas.width = width;
    canvas.height = dynamicHeight;

    // Apply 16px border radius to the entire card
    ctx.save();
    roundRect(0, 0, width, dynamicHeight, 16 * scaleFactor, false, false);
    ctx.clip();

    // 尝试加载字体并等待加载完成
    try {
      if (document.fonts) {
        // Extract all unique characters from stats to ensure subsetted fonts load them
        const statChars = Array.from(new Set(statsItems.map(s => (s.label + s.value + (s.unit || '')).split('')).flat())).join('');

        console.log('[Pink Pixel Debug] Triggering font loading...');
        // Trigger font loading
        const fontPromises = [
          document.fonts.load(`400 32px "LXGW Neo XiHei"`, charName + statChars + '初遇'),
          document.fonts.load(`700 32px "LXGW Neo XiHei"`, statChars),
          document.fonts.load(`400 32px "PING FANG SHAO HUA"`, statChars),
          document.fonts.load(`400 32px "DotGothic16"`, charName + statChars + '初遇于'),
          document.fonts.load(`400 48px "Long Cang"`, '初遇')
        ];

        // Wait for fonts to load, with a timeout to prevent hanging forever
        const timeoutPromise = new Promise(resolve => setTimeout(() => {
          console.warn('[Pink Pixel Debug] Font loading timed out!');
          resolve();
        }, 1500));
        
        await Promise.race([Promise.all(fontPromises), timeoutPromise]);
        console.log('[Pink Pixel Debug] Font loading completed or timed out.');
      }
    } catch (e) {
      if (DEBUG) console.warn('Font load trigger failed:', e);
      console.error('[Pink Pixel Debug] Font loading caught error:', e);
    }

    // Helper: Rounded Rect
    function roundRect(x, y, w, h, r, fill = true, stroke = false) {
      if (isPixel) {
        if (fill) {
          ctx.fillRect(x, y, w, h);
        }
        if (stroke) {
          ctx.strokeRect(x, y, w, h);
        }
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

    function drawPixelHeart(x, y, size, color) {
      ctx.save();
      ctx.fillStyle = color;
      const s = size / 7;
      // 7x7 pixel heart matrix
      const heart = [
        [0, 1, 1, 0, 1, 1, 0],
        [1, 1, 1, 1, 1, 1, 1],
        [1, 1, 1, 1, 1, 1, 1],
        [1, 1, 1, 1, 1, 1, 1],
        [0, 1, 1, 1, 1, 1, 0],
        [0, 0, 1, 1, 1, 0, 0],
        [0, 0, 0, 1, 0, 0, 0]
      ];
      for (let r = 0; r < 7; r++) {
        for (let c = 0; c < 7; c++) {
          if (heart[r][c]) {
            ctx.fillRect(x + c * s, y + r * s, s + 0.5, s + 0.5);
          }
        }
      }
      ctx.restore();
    }

    // 3. 绘制背景
    ctx.fillStyle = (shareStyle === 'ins') ? '#FFFFFF' : tealColor; // Ins style is white overall
    if (shareStyle === 'ins') {
      roundRect(0, 0, width, height, 24 * scaleFactor);
    } else if (isPixel) {
      ctx.fillRect(0, 0, width, height);
      // Pixel Border
      ctx.strokeStyle = '#FF9EB5';
      ctx.lineWidth = 4 * scaleFactor;
      ctx.strokeRect(20 * scaleFactor, 20 * scaleFactor, width - 40 * scaleFactor, height - 40 * scaleFactor);
    } else {
      ctx.fillRect(0, 0, width, headerH);
      ctx.fillStyle = cardBgColor;
      ctx.fillRect(0, headerH, width, dynamicHeight - headerH);
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
      ctx.fillStyle = '#FFFFFF';
      const margin = 40 * scaleFactor;
      ctx.fillRect(margin, margin, width - margin * 2, headerH - margin + 20 * scaleFactor);
    } else if (stats.length > 0) {
      ctx.fillStyle = contentAreaBg;
      const contentAreaW = 599 * scaleFactor;
      const contentAreaX = (width - contentAreaW) / 2;
      // const contentAreaH = totalStatsH; // Already defined as totalStatsH
      roundRect(contentAreaX, headerH, contentAreaW, totalStatsH, 24 * scaleFactor);
    }


    // 4. 绘制头像 (Moved to after background, before header logic)
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

    if (isPixel) {
      const avatarW = 80 * scaleFactor;
      const avatarH = 80 * scaleFactor;
      const gap = 120 * scaleFactor;
      const centerX = width / 2;
      const avatarY = 80 * scaleFactor;

      function drawPixelAvatar(img, x, y) {
        // Pixel Shadow
        ctx.fillStyle = '#FF9EB5';
        ctx.fillRect(x + 4 * scaleFactor, y + 4 * scaleFactor, avatarW, avatarH);
        // Photo Frame
        ctx.strokeStyle = '#B34E6C';
        ctx.lineWidth = 2 * scaleFactor;
        ctx.strokeRect(x, y, avatarW, avatarH);
        // Image
        ctx.save();
        ctx.rect(x + 1 * scaleFactor, y + 1 * scaleFactor, avatarW - 2 * scaleFactor, avatarH - 2 * scaleFactor);
        ctx.clip();
        if (img) {
          const scale = Math.max(avatarW / img.width, avatarH / img.height);
          const sw = img.width * scale;
          const sh = img.height * scale;
          ctx.drawImage(img, x + (avatarW - sw) / 2, y + (avatarH - sh) / 2, sw, sh);
        } else {
          ctx.fillStyle = '#eee';
          ctx.fillRect(x, y, avatarW, avatarH);
        }
        ctx.restore();
      }

      // Connector Line
      ctx.strokeStyle = '#FF9EB5';
      ctx.lineWidth = 2 * scaleFactor;
      ctx.beginPath();
      ctx.moveTo(centerX - gap / 2, avatarY + avatarH / 2);
      ctx.lineTo(centerX + gap / 2, avatarY + avatarH / 2);
      ctx.stroke();

      // Pixel Heart
      const heartSize = 42 * scaleFactor;
      drawPixelHeart(centerX - heartSize / 2, avatarY + avatarH / 2 - heartSize / 2, heartSize, '#FF9EB5');

      if (showUser) {
        drawPixelAvatar(charImg, centerX - gap / 2 - avatarW, avatarY);
        drawPixelAvatar(userImg, centerX + gap / 2, avatarY);
      } else {
        drawPixelAvatar(charImg, centerX - avatarW / 2, avatarY);
      }

      // Text Info below
      ctx.textAlign = 'center';
      ctx.fillStyle = charNameColor;
      ctx.font = `400 ${32 * scaleFactor}px "DotGothic16", sans-serif`;
      ctx.fillText(charName, centerX, avatarY + avatarH + 45 * scaleFactor);

      if (showEncounterDate) {
        ctx.font = `400 ${22 * scaleFactor}px "DotGothic16", sans-serif`;
        const dateText = `初遇于 ${$("#ccs-start").text().replace(/点/g, ':').replace(/分/g, '')}`;
        ctx.fillText(dateText, centerX, avatarY + avatarH + 78 * scaleFactor);
      }

    } else if (shareStyle === 'ins') {
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
        ctx.font = `400 ${31 * scaleFactor}px "LXGW Neo XiHei", "PingFang SC", sans-serif`; // Reverted to 400
        ctx.fillText(charName, infoX, infoY - 12 * scaleFactor); // Moved up slightly

        // Encounter Info
        const encounterText = `初遇 ${$("#ccs-start").text()}`;
        ctx.save();
        ctx.globalAlpha = 0.7; // 70% opacity per request
        ctx.fillStyle = statLabelColor;
        ctx.font = `400 ${25 * scaleFactor}px "LXGW Neo XiHei", "PingFang SC", sans-serif`; // Reverted to 400
        ctx.fillText(encounterText, infoX, infoY + 36 * scaleFactor); // Moved down slightly (+32 -> +36)
        ctx.restore();
      }
    }

    // 6. 绘制统计项
    const insContentH = 500 * scaleFactor;
    const actualStatsH = stats.length * boxH + (stats.length > 0 ? (stats.length - 1) * boxGap : 0);
    const statsStartY = (shareStyle === 'ins')
      ? (headerH + (insContentH - actualStatsH) / 2) // Vertically centered in fixed height
      : (isPixel ? (headerH + 60 * scaleFactor) : (isModern ? (headerH + 40 * scaleFactor) : (headerH + 100 * scaleFactor + 40 * scaleFactor)));

    const boxW = 519 * scaleFactor;
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
      } else if (isPixel) {
        // Shadow (Pixel Style)
        ctx.fillStyle = '#000000';
        ctx.fillRect(boxX + 4 * scaleFactor, cy + 4 * scaleFactor, boxW, boxH);
        // Box
        ctx.fillStyle = statBoxColor;
        ctx.fillRect(boxX, cy, boxW, boxH);
        // Border
        ctx.strokeStyle = '#B34E6C';
        ctx.lineWidth = 2 * scaleFactor;
        ctx.strokeRect(boxX, cy, boxW, boxH);

        // Label
        ctx.textAlign = 'left';
        ctx.fillStyle = statLabelColor;
        ctx.font = `400 ${28 * scaleFactor}px "DotGothic16", sans-serif`;
        ctx.fillText(stat.label, boxX + 24 * scaleFactor, cy + boxH / 2 + 10 * scaleFactor);

        // Value
        ctx.textAlign = 'right';
        const valueX = boxX + boxW - 24 * scaleFactor;
        const valText = `${stat.value}${stat.unit ? ' ' + stat.unit : ''}`;
        ctx.fillText(valText, valueX, cy + boxH / 2 + 10 * scaleFactor);

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
        ctx.font = `400 ${28 * scaleFactor}px "LXGW Neo XiHei", "PingFang SC", sans-serif`; // Reverted to 400
        ctx.fillText(stat.label, boxX + 32 * scaleFactor, cy + boxH / 2 + 8 * scaleFactor);

        // Value & Unit
        ctx.textAlign = 'right';
        const valueX = boxX + boxW - 32 * scaleFactor;

        if (stat.unit) {
          ctx.save();
          ctx.globalAlpha = 0.7; // 70% opacity for units
          ctx.fillStyle = statLabelColor;
          ctx.font = `400 ${24 * scaleFactor}px "LXGW Neo XiHei", "PingFang SC", sans-serif`; // Reverted to 400
          ctx.fillText(stat.unit, valueX, cy + boxH / 2 + 8 * scaleFactor);
          ctx.restore();

          const unitWidth = ctx.measureText(stat.unit).width;
          ctx.fillStyle = statValueColor;
          ctx.font = `700 ${28 * scaleFactor}px "LXGW Neo XiHei", "PingFang SC", sans-serif`; // Weight Bold
          ctx.fillText(stat.value, valueX - unitWidth - 8 * scaleFactor, cy + boxH / 2 + 8 * scaleFactor);
        } else {
          ctx.fillStyle = statValueColor;
          ctx.font = `700 ${28 * scaleFactor}px "LXGW Neo XiHei", "PingFang SC", sans-serif`;
          ctx.fillText(stat.value, valueX, cy + boxH / 2 + 8 * scaleFactor);
        }
      }
    });

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

    ctx.restore(); // Restore from card-level 16px clipping
    return canvas.toDataURL('image/png');
  }

  function showPreview(imageData) {
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
    $modal.css('display', 'flex');
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
    $modal.css('display', 'flex');

    try {
      const imageData = await generateShareImage();
      // Wait a tiny bit extra just in case
      await new Promise(r => setTimeout(r, 100));
      $container.removeClass('loading-preview');
      showPreview(imageData);
      $button.val('已生成');
    } catch (error) {
      console.error('生成分享图片失败:', error);
      $container.removeClass('loading-preview');
      $container.html('<p style="color:red; padding: 20px;">生成分享图片失败，请检查控制台。</p>');
    } finally {
      setTimeout(() => {
        $button.prop('disabled', false).val('分享');
      }, 1000);
    }
  });

  // 添加取消按钮事件处理
  $("#ccs-cancel").on("click", function () {
    $("#ccs-preview-modal").hide();
  });

  // 添加保存按钮事件
  $("#ccs-download").on("click", function () {
    const characterName = getCurrentCharacterName();
    const link = document.createElement('a');
    link.download = `羁绊卡片_${characterName}.png`;
    link.href = $("#ccs-preview-container img").attr('src');
    link.click();
  });

  // 点击模态框背景关闭
  $("#ccs-preview-modal").on("click", function (e) {
    if (e.target === this) {
      $(this).hide();
    }
  });

  // Debounced update function
  const debouncedUpdateStats = debounce(updateStats, 500); // 500ms delay

  // 初始化时的基本更新
  updateStats(); // Keep initial update on load

  // 风格切换处理 (在预览窗口中)
  $(document).on('change', '#ccs-style-select', async function () {
    shareStyle = $(this).val();
    if (DEBUG) console.log('Selected style changed (dropdown):', shareStyle);

    // 即时重新生成预览
    const $container = $("#ccs-preview-container");
    $container.addClass('loading-preview'); // Optional: visual feedback

    try {
      const imageData = await generateShareImage();
      const $img = $container.find('img');
      if ($img.length) {
        $img.attr('src', imageData);
      }
    } catch (e) {
      console.error('Failed to regenerate preview:', e);
      alert('生成预览失败: ' + e.message);
    } finally {
      $container.removeClass('loading-preview');
    }
  });

  // 绑定点击事件 - 使用事件委托以防动态加载问题
  $(document).on('click', '#ccs-refresh', updateStats);

  // Add change listener to checkboxes to update share button state
  $(document).on('change', '.ccs-share-option input[type="checkbox"]', function () {
    // Re-evaluate button state based on current message count whenever options change
    const currentMessageCount = parseInt($("#ccs-messages").text(), 10) || 0;
    updateShareButtonState(currentMessageCount);
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

  if (DEBUG) console.log("✅ 聊天陪伴统计插件已加载 (自动刷新已启用)");
});
