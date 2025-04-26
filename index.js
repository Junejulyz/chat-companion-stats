import { getContext } from "../../../extensions.js";
import { getPastCharacterChats } from '../../../../script.js';

const extensionName = "chat-companion-stats";
// Use an absolute path for web requests (relative to the domain root)
const extensionWebPath = `/scripts/extensions/third-party/${extensionName}`; 

jQuery(async () => {
  // 加载CSS文件 using absolute path
  $('head').append(`<link rel="stylesheet" type="text/css" href="${extensionWebPath}/styles.css">`);
  
  // 加载HTML using absolute path
  const settingsHtml = await $.get(`${extensionWebPath}/settings.html`);
  $("#extensions_settings2").append(settingsHtml);

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
    console.log(`Attempting to parse date: "${dateString}"`);
    if (!dateString) {
        console.log("Date string is empty, returning null.");
        return null;
    }

    // Try parsing the specific format "Month Day, Year HH:MMam/pm"
    const parts = dateString.match(/(\w+)\s+(\d+),\s+(\d+)\s+(\d+):(\d+)(am|pm)/i);
    console.log("Regex match result (parts):", parts);
    if (parts) {
      console.log("Regex matched specific format.");
      const monthName = parts[1];
      const day = parts[2];
      const year = parts[3];
      let hour = parseInt(parts[4], 10);
      const minute = parts[5];
      const ampm = parts[6].toLowerCase();
      console.log(`Parsed parts: Month=${monthName}, Day=${day}, Year=${year}, Hour=${hour}, Minute=${minute}, AMPM=${ampm}`);

      const monthNumber = monthMap[monthName];
      if (!monthNumber) {
         console.warn(`Unknown month name "${monthName}" in date string: ${dateString}`);
         return null;
      }
      console.log(`Month number: ${monthNumber}`);

      if (ampm === 'pm' && hour !== 12) {
        hour += 12;
        console.log(`Adjusted hour for PM: ${hour}`);
      } else if (ampm === 'am' && hour === 12) {
        hour = 0;
        console.log(`Adjusted hour for 12 AM: ${hour}`);
      }

      // Construct an ISO-like string that new Date() handles reliably
      const isoLikeString = `${year}-${monthNumber}-${day.padStart(2, '0')}T${String(hour).padStart(2, '0')}:${minute}:00`;
      console.log(`Constructed ISO-like string: ${isoLikeString}`);
      const date = new Date(isoLikeString);
      console.log(`Result of new Date(isoLikeString): ${date}`);
      const isValid = date && !isNaN(date.getTime());
      console.log(`Is parsed date valid? ${isValid}`);
      return isValid ? date : null;
    }

    console.log("Regex did not match specific format, trying fallback.");
    // Fallback: Try direct parsing for other potential formats
    const fallbackDate = new Date(dateString);
    console.log(`Result of fallback new Date(dateString): ${fallbackDate}`);
    const isFallbackValid = fallbackDate && !isNaN(fallbackDate.getTime());
    console.log(`Is fallback date valid? ${isFallbackValid}`);
    return isFallbackValid ? fallbackDate : null;
  }

  // 从文件名解析时间
  function parseTimeFromFilename(filename) {
    // 从文件名中提取日期和时间
    const match = filename.match(/(\d{4}-\d{2}-\d{2})@(\d{2})h(\d{2})m(\d{2})s/);
    if (match) {
      const [_, date, hours, minutes, seconds] = match;
      return {
        date,
        time: `${hours}:${minutes}:${seconds}`,
        fullDateTime: `${date} ${hours}:${minutes}:${seconds}`
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

  // 计算消息的字数
  function countWordsInMessage(message) {
    const text = message.replace(/<[^>]*>/g, '');
    const chineseChars = text.match(/[\u4e00-\u9fff]/g) || [];
    const englishWords = text.match(/[a-zA-Z0-9]+/g) || [];
    const chineseCount = chineseChars.length;
    const englishCount = englishWords.length;
    const totalCount = chineseCount + englishCount;
    
    if (totalCount === 0) return 0;

    const chineseRatio = chineseCount / totalCount;
    const englishRatio = englishCount / totalCount;

    // 优化：中文按1字，英文按0.6字处理
    const optimizedWordCount = chineseCount * 1 + englishCount * 0.6;

    return optimizedWordCount;
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

  // 获取最大的聊天文件内容
  async function fetchLargestChatFile(characterId) {
    const chats = await getPastCharacterChats(characterId);
    
    if (!chats || chats.length === 0) return null;
    
    // 找最大文件
    const largestChat = chats.reduce((prev, current) => {
      const prevSize = parseFloat(prev.file_size) || 0;
      const currentSize = parseFloat(current.file_size) || 0;
      return (currentSize > prevSize) ? current : prev;
    });

    if (!largestChat || !largestChat.file_name) return null;

    try {
        const context = getContext();
        const charId = context.characterId;
        const fullFileName = largestChat.file_name;
        const encodedFullFileName = encodeURIComponent(fullFileName); // Encode filename once

        let sampledMessages = null;

        // --- Attempt 1: Use characterId (avatar filename) ---
        console.log("fetchLargestChatFile: Attempt 1 using characterId:", charId);
        if (charId && typeof charId === 'string' && charId !== '0') {
            const lastDotIndex = charId.lastIndexOf('.');
            const folderNameFromId = lastDotIndex > 0 ? charId.substring(0, lastDotIndex) : charId;
            console.log("fetchLargestChatFile: Derived folder name from ID:", folderNameFromId);

            const filePathById = `/chats/${folderNameFromId}/${encodedFullFileName}`;
            console.log(`Attempt 1: Trying path: ${filePathById}`);
            try {
                const response = await fetch(filePathById, { credentials: 'same-origin' });
                if (response.ok) {
                    console.log(`Attempt 1: Success fetching ${filePathById}`);
                    const text = await response.text();
                    const lines = text.trim().split('\n');
                    sampledMessages = lines.slice(0, 100).map(line => JSON.parse(line));
                    return sampledMessages; // Success, return early
                } else {
                    console.warn(`Attempt 1: Failed fetching ${filePathById}, Status: ${response.status}. Trying fallback.`);
                }
            } catch (fetchError) {
                 console.warn(`Attempt 1: Error during fetch for ${filePathById}:`, fetchError, ". Trying fallback.");
            }
        } else {
             console.warn("Attempt 1: Invalid characterId found:", charId, ". Skipping ID-based path, trying fallback.");
        }

        // --- Attempt 2 (Fallback): Use encoded character name from filename ---
        console.log("fetchLargestChatFile: Attempt 2 using encoded character name from filename.");
        const characterNameFromName = fullFileName.split(' - ')[0];
        const encodedCharacterName = encodeURIComponent(characterNameFromName);
        const filePathByName = `/chats/${encodedCharacterName}/${encodedFullFileName}`; // Use encoded filename here too
        console.log(`Attempt 2: Trying path: ${filePathByName}`);
        try {
            const response = await fetch(filePathByName, { credentials: 'same-origin' });
            if (response.ok) {
                console.log(`Attempt 2: Success fetching ${filePathByName}`);
                const text = await response.text();
                const lines = text.trim().split('\n');
                sampledMessages = lines.slice(0, 100).map(line => JSON.parse(line));
                return sampledMessages; // Success
            } else {
                console.warn(`Attempt 2: Failed fetching ${filePathByName}, Status: ${response.status}. Giving up.`);
                return null; // Both attempts failed
            }
        } catch (fetchError) {
            console.error(`Attempt 2: Error during fetch for ${filePathByName}:`, fetchError, ". Giving up.");
            return null; // Both attempts failed
        }

    } catch (error) {
        console.error("Error in fetchLargestChatFile logic:", error);
        return null;
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
    const characterId = context.characterId;
    if (characterId === undefined) {
      console.log('未找到当前角色ID');
      return {
        messageCount: 0,
        wordCount: 0,
        firstTime: null,
        totalDuration: 0,
        totalSizeBytes: 0 // Change to return bytes
      };
    }

    try {
      const chats = await getPastCharacterChats(characterId);
      console.log('获取到的聊天记录:', chats);

      let totalMessagesFromChats = 0;
      let totalSizeKB = 0;
      let earliestTime = null;
      let totalDurationSeconds = 0;
      let totalSizeBytesRaw = 0; // Variable to store raw bytes

      chats.forEach(chat => {
        totalMessagesFromChats += chat.chat_items || 0;
        
        // 计算文件大小 (store raw bytes)
        const sizeMatchKB = chat.file_size?.match(/([\d.]+)\s*KB/i);
        const sizeMatchMB = chat.file_size?.match(/([\d.]+)\s*MB/i);
        const sizeMatchBytes = chat.file_size?.match(/^(\d+)$/); // Match plain bytes

        if (sizeMatchMB) {
            totalSizeBytesRaw += parseFloat(sizeMatchMB[1]) * 1024 * 1024;
        } else if (sizeMatchKB) {
            totalSizeBytesRaw += parseFloat(sizeMatchKB[1]) * 1024;
        } else if (sizeMatchBytes) {
            totalSizeBytesRaw += parseInt(sizeMatchBytes[1], 10);
        } else if (chat.file_size) {
            // Attempt to parse if it's just a number (assume bytes)
            const sizeAsNumber = parseFloat(chat.file_size);
            if (!isNaN(sizeAsNumber)) {
                totalSizeBytesRaw += sizeAsNumber;
            } else {
                console.warn(`Could not parse file size: ${chat.file_size}`);
            }
        }

        // --- Calculate totalSizeKB (for word count estimation) --- ADDED BACK
        // This specifically looks for the "KB" unit in the original string
        const sizeMatchKB_est = chat.file_size?.match(/([\d.]+)\s*KB/i);
        if (sizeMatchKB_est) {
          totalSizeKB += parseFloat(sizeMatchKB_est[1]);
        }
        // Note: We are intentionally *not* converting MB or Bytes here for the estimation logic,
        // as it historically relied only on the KB value provided by the API.


        // 获取最早时间 using the robust parser
        if (chat.last_mes) {
          console.log('Processing chat with last_mes:', chat.last_mes);
          const date = parseSillyTavernDate(chat.last_mes);
          console.log('Parsed date:', date);
          if (date) {
            if (!earliestTime || date < earliestTime) {
              earliestTime = date;
              console.log('Updated earliestTime to:', earliestTime);
            }
          } else if (chat.last_mes) {
            console.warn(`Could not parse date format: ${chat.last_mes}`);
          }
        }

        // 从文件名解析时间
        if (chat.file_name) {
          const timeInfo = parseTimeFromFilename(chat.file_name);
          if (timeInfo) {
            totalDurationSeconds += timeInfo.totalSeconds;
            console.log('Added duration from file:', timeInfo);
          }
        }
      });

      // 获取当前聊天的统计信息
      const currentStats = getCurrentChatStats();
      console.log('当前聊天统计:', currentStats);

      // 计算当前聊天的总字数和总大小
      const totalWords = currentStats.user.words + currentStats.char.words;
      const totalSizeBytes = currentStats.user.size + currentStats.char.size;
      const currentMessageCount = currentStats.user.count + currentStats.char.count;

      // 计算估算字数
      let estimatedWords = 0;

      // 如果当前聊天消息数量少（<=2）且有历史文件，使用基于历史元数据的估算
      if (currentMessageCount <= 2 && chats && chats.length > 0 && totalMessagesFromChats > 0) {
          console.log(`当前消息数 (${currentMessageCount}) <= 2，使用历史元数据估算...`);
          // 1. 使用默认密度估算历史总字数
          const historicalWordsEstimateFromSize = totalSizeKB * 32.5; // Default density
          // 2. 计算历史平均每条消息字数
          const historicalAvgWordsPerMessage = historicalWordsEstimateFromSize / totalMessagesFromChats;
          // 3. 使用历史平均字数 * 总历史消息数 作为最终估算
          estimatedWords = Math.round(totalMessagesFromChats * historicalAvgWordsPerMessage);

          console.log(`使用历史元数据估算:`);
          console.log(`- 历史文件: ${totalMessagesFromChats}条消息, ${totalSizeKB.toFixed(2)}KB`);
          console.log(`- 历史平均字数 (估算): ${historicalAvgWordsPerMessage.toFixed(2)}字/条`);
          console.log(`- 最终估算: ${estimatedWords}字`);
      }
      // 如果当前聊天有足够消息 (>2)，使用当前聊天综合估算 (区分用户/角色)
      else if (currentMessageCount > 2) {
        console.log(`当前消息数 (${currentMessageCount}) > 2，使用当前聊天综合估算...`);
        
        // Check if we have stats for both user and character in the current chat
        if (currentStats.user.count > 0 && currentStats.char.count > 0 && totalSizeBytes > 0) {
            console.log(`区分用户/角色进行估算...`);
            // Calculate separate stats based on current chat
            const userWordsPerKB = currentStats.user.size > 0 ? currentStats.user.words / (currentStats.user.size / 1024) : 0;
            const userAvgWords = currentStats.user.words / currentStats.user.count;
            const charWordsPerKB = currentStats.char.size > 0 ? currentStats.char.words / (currentStats.char.size / 1024) : 0;
            const charAvgWords = currentStats.char.words / currentStats.char.count;

            // Estimate historical split (simple 50/50 for messages, ratio-based for size)
            const histUserMessages = totalMessagesFromChats / 2;
            const histCharMessages = totalMessagesFromChats / 2;
            const currentUserSizeRatio = currentStats.user.size / totalSizeBytes;
            const histUserSizeKB = totalSizeKB * currentUserSizeRatio;
            const histCharSizeKB = totalSizeKB * (1 - currentUserSizeRatio);

            // Estimate using separate densities
            const densityEstimate = (histUserSizeKB * userWordsPerKB) + (histCharSizeKB * charWordsPerKB);
            // Estimate using separate averages
            const avgEstimate = (histUserMessages * userAvgWords) + (histCharMessages * charAvgWords);

            // Use the minimum of the two refined estimates
            estimatedWords = Math.min(Math.round(densityEstimate), Math.round(avgEstimate));

            console.log(`使用区分用户/角色的综合估算:`);
            console.log(`- 当前用户: ${currentStats.user.words.toFixed(1)}字, ${(currentStats.user.size/1024).toFixed(2)}KB, ${currentStats.user.count}条`);
            console.log(`  - 用户密度: ${userWordsPerKB.toFixed(2)}字/KB, 用户平均: ${userAvgWords.toFixed(2)}字/条`);
            console.log(`- 当前角色: ${currentStats.char.words.toFixed(1)}字, ${(currentStats.char.size/1024).toFixed(2)}KB, ${currentStats.char.count}条`);
            console.log(`  - 角色密度: ${charWordsPerKB.toFixed(2)}字/KB, 角色平均: ${charAvgWords.toFixed(2)}字/条`);
            console.log(`- 历史文件: ${totalMessagesFromChats}条消息, ${totalSizeKB.toFixed(2)}KB`);
            console.log(`  - 估算历史用户: ${histUserMessages.toFixed(0)}条, ${histUserSizeKB.toFixed(2)}KB`);
            console.log(`  - 估算历史角色: ${histCharMessages.toFixed(0)}条, ${histCharSizeKB.toFixed(2)}KB`);
            console.log(`- 密度估算(分开): ${Math.round(densityEstimate)}字`);
            console.log(`- 平均估算(分开): ${Math.round(avgEstimate)}字`);
            console.log(`- 最终估算(取较小值): ${estimatedWords}字`);

        } else {
            // Fallback to simpler combined estimation if current chat is one-sided or has zero size
            console.log(`当前聊天样本不均衡或大小为零，回退到简单综合估算...`);
            const wordsPerKB = totalSizeBytes > 0 ? totalWords / (totalSizeBytes / 1024) : 0;
            const avgWordsPerMessage = totalWords / currentMessageCount;
            const estimateByDensity = totalSizeKB * wordsPerKB;
            const estimateByAvgWords = avgWordsPerMessage * totalMessagesFromChats;
            estimatedWords = Math.min(Math.round(estimateByDensity), Math.round(estimateByAvgWords));

            console.log(`使用简单综合估算:`);
            console.log(`- 当前聊天: ${totalWords}字, ${(totalSizeBytes/1024).toFixed(2)}KB, ${currentMessageCount}条消息`);
            console.log(`- 历史文件: ${totalMessagesFromChats}条消息, ${totalSizeKB.toFixed(2)}KB`);
            console.log(`- 字数密度: ${wordsPerKB.toFixed(2)}字/KB`);
            console.log(`- 平均字数: ${avgWordsPerMessage.toFixed(2)}字/条`);
            console.log(`- 密度估算: ${Math.round(estimateByDensity)}字`);
            console.log(`- 平均估算: ${Math.round(estimateByAvgWords)}字`);
            console.log(`- 最终估算(取较小值): ${estimatedWords}字`);
        }
        console.log(`中英文比例 - 用户: 中文 ${(currentStats.user.chineseRatio * 100).toFixed(1)}%, 英文 ${(currentStats.user.englishRatio * 100).toFixed(1)}%`);
        console.log(`中英文比例 - 角色: 中文 ${(currentStats.char.chineseRatio * 100).toFixed(1)}%, 英文 ${(currentStats.char.englishRatio * 100).toFixed(1)}%`);

      } else {
        // 兜底方案：用totalSizeKB × 30
        estimatedWords = Math.round(totalSizeKB * 30);
        console.log(`无采样数据，采用大小估算: ${estimatedWords}`);
      }

      console.log('统计结果:', {
        totalMessages: totalMessagesFromChats,
        estimatedWords,
        earliestTime: (earliestTime && !isNaN(earliestTime.getTime())) ? earliestTime.toISOString() : null,
        totalDurationSeconds,
        totalSizeBytes: totalSizeBytesRaw // Include raw bytes in final log
      });

      // Additional check: If multiple files exist, are they all minimal (<=1 message)?
      let allFilesAreMinimal = false;
      if (chats && chats.length > 1) {
          allFilesAreMinimal = chats.every(chat => (chat.chat_items || 0) <= 1);
          if (allFilesAreMinimal) {
              console.log(`检测到多个聊天文件，但每个文件消息数都 <= 1。`);
          }
      }

      // Final check: Treat as no interaction if total messages <= 1 OR if all files are minimal
      if (totalMessagesFromChats <= 1 || allFilesAreMinimal) {
          console.log(`总消息数 (${totalMessagesFromChats}) <= 1 或所有文件消息数均 <= 1，重置统计数据为“尚未互动”状态。`);
          return {
              messageCount: 0,
              wordCount: 0,
              firstTime: null,
              totalDuration: 0,
              totalSizeBytes: 0 
          };
      }

      // Otherwise, return the calculated stats
      return {
        messageCount: totalMessagesFromChats,
        wordCount: estimatedWords,
        firstTime: earliestTime,
        totalDuration: totalDurationSeconds,
        totalSizeBytes: totalSizeBytesRaw // Return raw bytes
      };
    } catch (error) {
      console.error('获取统计数据失败:', error);
      return {
        messageCount: 0,
        wordCount: 0,
        firstTime: null,
        totalDuration: 0,
        totalSizeBytes: 0 // Return default on error
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
      console.log('updateShareButtonState: Disabled (messageCount <= 1)');
      return; 
    }

    // If interaction exists (messageCount > 1), check if options are selected
    const anyOptionChecked = $('.ccs-share-option input[type="checkbox"]:checked').length > 0;

    if (anyOptionChecked) {
      $shareButton.prop('disabled', false).val('分享');
      console.log('updateShareButtonState: Enabled (options checked)');
    } else {
      $shareButton.prop('disabled', true).val('请选择内容');
      console.log('updateShareButtonState: Disabled (no options checked)');
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
    console.log('Attempting to update stats...');
    const characterName = getCurrentCharacterName();
    $("#ccs-character").text(characterName);
    try {
      const context = getContext();
      const stats = await getFullStats();
      console.log('Stats received in updateStats:', stats);

      // 获取聊天文件数量
      const chats = await getPastCharacterChats(context.characterId);
      const chatFilesCount = chats ? chats.length : 0;

      // 始终显示字数估算提示
      $("#ccs-tip").show();

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


      if (!stats.firstTime) {
        console.log('No firstTime found in stats');
        $("#ccs-start").text("尚未互动");
        $("#ccs-days").text("0");
        // Pass messageCount even if firstTime is null
        updateShareButtonState(stats.messageCount); 
      } else {
        const now = new Date();
        // Ensure stats.firstTime is a Date object
        const firstTimeDate = stats.firstTime instanceof Date ? stats.firstTime : new Date(stats.firstTime);
        console.log('First time date:', firstTimeDate);
        
        // 使用 UTC 日期来避免时区问题
        const utcNow = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
        const utcFirstTime = Date.UTC(firstTimeDate.getFullYear(), firstTimeDate.getMonth(), firstTimeDate.getDate());
        
        // 计算天数：从第一次互动到现在的天数（包括今天）
        const diffTime = Math.abs(utcNow - utcFirstTime);
        const days = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1; // 加1确保包括今天
        console.log('Calculated days:', days);
        
        // 格式化初遇时间
        const firstTimeFormatted = formatDateTime(stats.firstTime);
        console.log('Formatted first time:', firstTimeFormatted);

        $("#ccs-start").text(firstTimeFormatted);
        $("#ccs-days").text(days);
        // Pass messageCount to the state function
        updateShareButtonState(stats.messageCount); 
      }
      // Removed the stray 'else' block that was here


      console.log('Stats UI updated:', {
        messages: stats.messageCount,
        words: stats.wordCount,
        firstTime: stats.firstTime,
        days: $("#ccs-days").text()
      });

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
          console.log("getUserAvatar: Found avatar in chat message.");
          return avatar.src;
        }
      }
    }

    // Priority 2 (Fallback): Try to get avatar from persona selection
    const userAvatarContainer = document.querySelector('.avatar-container[data-avatar-id="user-default.png"]');
    if (userAvatarContainer) {
      const avatar = userAvatarContainer.querySelector('img');
      if (avatar && avatar.src) {
        console.log("getUserAvatar: Found avatar in persona selection.");
        return avatar.src;
      }
    }
    
    console.log("getUserAvatar: Could not find user avatar.");
    return null; // Return null if not found in either place
  }

  async function generateShareImage() {
    const canvas = document.getElementById('ccs-canvas');
    const ctx = canvas.getContext('2d');
    const baseWidth = 1200; // Keep width fixed

    // --- Define constants for layout ---
    const topSectionHeight = 600; // Increased again for more space below divider
    const bottomPadding = 60;    // Padding below watermark
    const watermarkHeight = 40;   // Approx height for watermark line
    const lineHeight = 90;      // Height per stat line

    // --- Get stat values ---
    const characterName = $("#ccs-character").text();
    const startDate = $("#ccs-start").text();
    const messages = $("#ccs-messages").text();
    const words = $("#ccs-words").text();
    const days = $("#ccs-days").text();
    const totalSize = $("#ccs-total-size").text(); // Get the formatted size from UI

    // --- Build array of STAT lines to draw based on selections ---
    const statsToDraw = [];
    const shareStartChecked = $("#ccs-share-start").is(":checked");

    if (shareStartChecked) {
        statsToDraw.push(`与 ${characterName} 初遇于`);
        statsToDraw.push(startDate);
    } else {
        statsToDraw.push(`与 ${characterName}`);
    }
    if ($("#ccs-share-messages").is(":checked")) {
        statsToDraw.push(`共对话 ${messages} 条`);
    }
    if ($("#ccs-share-words").is(":checked")) {
        statsToDraw.push(`共聊天约 ${words} 字`);
    }
    if ($("#ccs-share-days").is(":checked")) {
        statsToDraw.push(`相伴 ${days} 天`);
    }
    // Add the new "回忆大小" stat if the corresponding UI element has a value, using the correct format
    if (totalSize && totalSize !== '--' && $("#ccs-share-size").is(":checked")) { // Check a new checkbox ID
        // Ensure the format is "回忆大小: X.XX MB/KB/B"
        statsToDraw.push(`回忆大小 ${totalSize}`); // totalSize already includes the formatted size and unit from updateStats
    }

    // --- Calculate dynamic height ---
    const statsTextHeight = statsToDraw.length * lineHeight;
    const calculatedHeight = topSectionHeight + statsTextHeight + watermarkHeight + bottomPadding;

    // --- Set canvas dimensions ---
    canvas.width = baseWidth;
    canvas.height = calculatedHeight; // Set dynamic height

    // --- Start Drawing ---
    // 绘制背景
    ctx.fillStyle = '#1f2937';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    
    // 添加渐变边框 (using dynamic height)
    const gradient = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
    gradient.addColorStop(0, '#3b82f6');
    gradient.addColorStop(1, '#8b5cf6');
    ctx.strokeStyle = gradient;
    ctx.lineWidth = 12; // Increased border width
    ctx.strokeRect(6, 6, canvas.width - 12, canvas.height - 12); // Use dynamic height

    // 加载头像
    const avatarUrl = getCharacterAvatar();
    const userAvatarUrl = getUserAvatar();

    const avatarY = 140; // Doubled
    const spacing = 400; // Doubled
    const avatarWidth = 180; // Doubled
    const avatarHeight = 240; // Doubled
    const cornerRadius = 20; // Doubled

    // 预加载两个头像
    let characterAvatar = null;
    let userAvatar = null;
    
    if (avatarUrl) {
      try {
        characterAvatar = await new Promise((resolve, reject) => {
          const img = new Image();
          img.crossOrigin = 'anonymous';
          img.onload = () => resolve(img);
          img.onerror = reject;
          img.src = avatarUrl;
        });
      } catch (error) {
        console.error('加载角色头像失败:', error);
      }
    }
    
    if (userAvatarUrl) {
      try {
        userAvatar = await new Promise((resolve, reject) => {
          const img = new Image();
          img.crossOrigin = 'anonymous';
          img.onload = () => resolve(img);
          img.onerror = reject;
          img.src = userAvatarUrl;
        });
      } catch (error) {
        console.error('加载用户头像失败:', error);
      }
    }

    // 绘制圆角矩形函数
    function drawRoundedRect(x, y, width, height, radius) {
      ctx.beginPath();
      ctx.moveTo(x + radius, y);
      ctx.lineTo(x + width - radius, y);
      ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
      ctx.lineTo(x + width, y + height - radius);
      ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
      ctx.lineTo(x + radius, y + height);
      ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
      ctx.lineTo(x, y + radius);
      ctx.quadraticCurveTo(x, y, x + radius, y);
      ctx.closePath();
    }

    // 绘制链接符号
    function drawChainSymbol(x, y) {
      const symbolSize = 60;  // Doubled: 调整锁的整体大小
      ctx.save();
      ctx.translate(x, y);

      // 创建渐变
      const lockGradient = ctx.createLinearGradient(-symbolSize/2, -symbolSize/2, symbolSize/2, symbolSize/2);
      lockGradient.addColorStop(0, '#3b82f6');
      lockGradient.addColorStop(1, '#8b5cf6');

      ctx.strokeStyle = lockGradient;
      ctx.fillStyle = lockGradient;
      ctx.lineWidth = 6; // Doubled

      // 绘制锁的拱形顶部
      const archWidth = symbolSize * 0.6;
      const archHeight = symbolSize * 0.4;
      ctx.beginPath();
      ctx.moveTo(-archWidth/2, -symbolSize/4);
      ctx.bezierCurveTo(
        -archWidth/2, -symbolSize/2,
        archWidth/2, -symbolSize/2,
        archWidth/2, -symbolSize/4
      );
      ctx.stroke();
      
      // 绘制锁的主体（圆角矩形）
      const lockWidth = symbolSize * 0.7;
      const lockHeight = symbolSize * 0.6;
      ctx.beginPath();
      const radius = 10; // Doubled
      ctx.moveTo(-lockWidth/2 + radius, -symbolSize/4);
      ctx.lineTo(lockWidth/2 - radius, -symbolSize/4);
      ctx.quadraticCurveTo(lockWidth/2, -symbolSize/4, lockWidth/2, -symbolSize/4 + radius);
      ctx.lineTo(lockWidth/2, -symbolSize/4 + lockHeight - radius);
      ctx.quadraticCurveTo(lockWidth/2, -symbolSize/4 + lockHeight, lockWidth/2 - radius, -symbolSize/4 + lockHeight);
      ctx.lineTo(-lockWidth/2 + radius, -symbolSize/4 + lockHeight);
      ctx.quadraticCurveTo(-lockWidth/2, -symbolSize/4 + lockHeight, -lockWidth/2, -symbolSize/4 + lockHeight - radius);
      ctx.lineTo(-lockWidth/2, -symbolSize/4 + radius);
      ctx.quadraticCurveTo(-lockWidth/2, -symbolSize/4, -lockWidth/2 + radius, -symbolSize/4);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      // 绘制锁孔
      ctx.beginPath();
      ctx.arc(0, 0, 6, 0, Math.PI * 2); // Doubled radius
      ctx.fillStyle = '#1f2937';  // 使用背景色
      ctx.fill();

      // 绘制锁孔下方的线
      ctx.beginPath();
      ctx.moveTo(0, 6); // Doubled y start
      ctx.lineTo(0, 16); // Doubled y end
      ctx.strokeStyle = '#1f2937';
      ctx.stroke();
      
      ctx.restore();
    }

    // 绘制头像函数
    function drawAvatar(img, x, isCharacter) {
      // 绘制背景板
      ctx.fillStyle = '#2a3441';
      drawRoundedRect(x, avatarY, avatarWidth, avatarHeight, cornerRadius);
      ctx.fill();
      
      // 绘制头像边框
      const borderGradient = ctx.createLinearGradient(x, avatarY, x, avatarY + avatarHeight);
      borderGradient.addColorStop(0, '#3b82f6');
      borderGradient.addColorStop(1, '#8b5cf6');
      ctx.strokeStyle = borderGradient;
      ctx.lineWidth = 4; // Doubled
      drawRoundedRect(x, avatarY, avatarWidth, avatarHeight, cornerRadius);
      ctx.stroke();

      // 绘制头像
      if (img) {
        ctx.save();
        drawRoundedRect(x, avatarY, avatarWidth, avatarHeight, cornerRadius);
        ctx.clip();
        const scale = Math.max(avatarWidth / img.width, avatarHeight / img.height);
        const scaledWidth = img.width * scale;
        const scaledHeight = img.height * scale;
        const drawX = x + (avatarWidth - scaledWidth) / 2;
        const drawY = avatarY + (avatarHeight - scaledHeight) / 2;
        ctx.drawImage(img, drawX, drawY, scaledWidth, scaledHeight);
        ctx.restore();
      }
    }
    
    // 绘制两个头像（用户头像在左边，角色头像在右边）
    const leftX = canvas.width / 2 - spacing / 2 - avatarWidth;
    const rightX = canvas.width / 2 + spacing / 2;
    drawAvatar(userAvatar, leftX, false);
    drawAvatar(characterAvatar, rightX, true);
    
    // 绘制虚线连接
    const lineY = avatarY + avatarHeight / 2;
    const lineStartX = leftX + avatarWidth + 20; // Doubled spacing
    const lineEndX = rightX - 20; // Doubled spacing

    // 绘制渐变虚线
    const lineGradient = ctx.createLinearGradient(lineStartX, lineY, lineEndX, lineY);
    lineGradient.addColorStop(0, '#3b82f6');
    lineGradient.addColorStop(1, '#8b5cf6');
    ctx.beginPath();
    ctx.strokeStyle = lineGradient;
    ctx.lineWidth = 4; // Doubled
    ctx.setLineDash([10, 6]); // Doubled dash pattern
    ctx.moveTo(lineStartX, lineY);
    ctx.lineTo(lineEndX, lineY);
    ctx.stroke();
    ctx.setLineDash([]);
    
    // 绘制锁符号
    drawChainSymbol(canvas.width / 2, lineY);
    
    // 设置文本样式
    ctx.textAlign = 'center';
    ctx.fillStyle = '#ffffff';

    // 绘制标题
    ctx.font = 'bold 64px Arial'; // Doubled font size
    ctx.fillText('我的羁绊', canvas.width / 2, 480); // Doubled y position

    // 绘制分割线
    ctx.beginPath();
    ctx.strokeStyle = '#4b5563';
    ctx.lineWidth = 4; // Doubled
    const dividerY = 520; // Doubled: 分割线位置
    ctx.moveTo(300, dividerY); // Doubled x start
    ctx.lineTo(900, dividerY); // Doubled x end
    ctx.stroke();

    // 绘制统计信息
    ctx.font = '52px Arial'; // Doubled font size
    // Add watermark text
    const watermarkText = `SillyTavern羁绊助手`;

    // 调整文本起始绘制位置
    const startDrawY = topSectionHeight; // Y position to start drawing the first stat line

    // Draw the main stats text lines
    statsToDraw.forEach((text, index) => {
      const currentY = startDrawY + index * lineHeight;
      ctx.font = '52px Arial';
      ctx.fillStyle = '#ffffff';
      ctx.fillText(text, canvas.width / 2, currentY);
    });

    // Draw the watermark near the bottom
    ctx.font = '32px Arial';
    ctx.fillStyle = '#6b7280';
    const watermarkY = canvas.height - bottomPadding; // Position near the bottom using dynamic height
    ctx.fillText(watermarkText, canvas.width / 2, watermarkY);
    
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
  $("#ccs-refresh").on("click", async function() {
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

  // 添加分享按钮事件处理
  $("#ccs-share").on("click", async function() {
    const $button = $(this);
    if ($button.prop('disabled')) return; // 如果按钮被禁用，直接返回
    
    $button.prop('disabled', true).val('生成中...');
    
    try {
      const imageData = await generateShareImage();
      showPreview(imageData);
      $button.val('已生成');
    } catch (error) {
      console.error('生成分享图片失败:', error);
    } finally {
      setTimeout(() => {
        $button.prop('disabled', false).val('分享');
      }, 1000);
    }
  });

  // 添加取消按钮事件处理
  $("#ccs-cancel").on("click", function() {
    $("#ccs-preview-modal").hide();
  });

  // 添加保存按钮事件
  $("#ccs-download").on("click", function() {
    const characterName = getCurrentCharacterName();
    const link = document.createElement('a');
    link.download = `羁绊卡片_${characterName}.png`;
    link.href = $("#ccs-preview-container img").attr('src');
    link.click();
  });

  // 点击模态框背景关闭
  $("#ccs-preview-modal").on("click", function(e) {
    if (e.target === this) {
      $(this).hide();
    }
  });

  // Debounced update function
  const debouncedUpdateStats = debounce(updateStats, 500); // 500ms delay

  // 初始化时的基本更新
  updateStats(); // Keep initial update on load

  // Add change listener to checkboxes to update share button state
  $(document).on('change', '.ccs-share-option input[type="checkbox"]', function() {
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
             console.log('Selected character change observed, triggering debounced update...');
             debouncedUpdateStats();
             return; // Only need to trigger once per batch of mutations
        }
    }
  });

  // Find the target element to observe - #rm_button_selected_ch seems appropriate
  const selectedCharElement = document.getElementById("rm_button_selected_ch");
  if (selectedCharElement) {
      console.log('Observing #rm_button_selected_ch for mutations.');
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

  console.log("✅ 聊天陪伴统计插件已加载 (自动刷新已启用)");
});
