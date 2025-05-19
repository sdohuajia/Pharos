require('dotenv').config();
const { ethers } = require('ethers');
const fs = require('fs');
const { HttpsProxyAgent } = require('https-proxy-agent');
const randomUseragent = require('random-useragent');
const axios = require('axios');

const colors = {
  reset: '\x1b[0m',
  cyan: '\x1b[36m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  white: '\x1b[37m',
  bold: '\x1b[1m',
};

const logger = {
  info: (msg) => console.log(`${colors.green}[✓] ${msg}${colors.reset}`),
  wallet: (msg) => console.log(`${colors.yellow}[➤] ${msg}${colors.reset}`),
  warn: (msg) => console.log(`${colors.yellow}[!] ${msg}${colors.reset}`),
  error: (msg) => console.log(`${colors.red}[✗] ${msg}${colors.reset}`),
  success: (msg) => console.log(`${colors.green}[+] ${msg}${colors.reset}`),
  loading: (msg) => console.log(`${colors.cyan}[⟳] ${msg}${colors.reset}`),
  step: (msg) => console.log(`${colors.white}[➤] ${msg}${colors.reset}`),
};

const networkConfig = {
  name: 'Pharos 测试网',
  chainId: 688688,
  rpcUrls: ['https://testnet.dplabs-internal.com'], // Add more RPCs if available
  currencySymbol: 'PHRS',
};

const tokens = {
  USDC: '0xad902cf99c2de2f1ba5ec4d642fd7e49cae9ee37',
  WPHRS: '0x76aaada469d23216be5f7c596fa25f282ff9b364',
};

const contractAddress = '0x1a4de519154ae51200b0ad7c90f7fac75547888a';

const tokenDecimals = {
  WPHRS: 18,
  USDC: 6,
};

const contractAbi = [
  'function multicall(uint256 collectionAndSelfcalls, bytes[] data) public',
];

const erc20Abi = [
  'function balanceOf(address) view returns (uint256)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function approve(address spender, uint256 amount) public returns (bool)',
];

const checkAllBalances = async (wallet, provider) => {
  try {
    logger.step(`检查钱包 ${wallet.address} 的余额`);
    const phrsBalance = await provider.getBalance(wallet.address);
    logger.info(`PHRS 余额: ${ethers.formatEther(phrsBalance)} ${networkConfig.currencySymbol}`);
    const usdcContract = new ethers.Contract(tokens.USDC, erc20Abi, provider);
    const usdcBalance = await usdcContract.balanceOf(wallet.address);
    logger.info(`USDC 余额: ${ethers.formatUnits(usdcBalance, tokenDecimals.USDC)} USDC`);
    const wphrsContract = new ethers.Contract(tokens.WPHRS, erc20Abi, provider);
    const wphrsBalance = await wphrsContract.balanceOf(wallet.address);
    logger.info(`WPHRS 余额: ${ethers.formatUnits(wphrsBalance, tokenDecimals.WPHRS)} WPHRS`);
  } catch (error) {
    logger.error(`检查余额失败: ${error.message}\n堆栈: ${error.stack}`);
  }
};

const loadProxies = () => {
  try {
    const proxies = fs.readFileSync('proxies.txt', 'utf8')
      .split('\n')
      .map(line => line.trim())
      .filter(line => line);
    logger.info(`成功加载 ${proxies.length} 个代理`);
    return proxies;
  } catch (error) {
    logger.warn('未找到 proxies.txt 或加载失败，使用直接模式');
    return [];
  }
};

const getRandomProxy = (proxies) => {
  return proxies[Math.floor(Math.random() * proxies.length)];
};

const validateProxy = async (proxy) => {
  try {
    const start = Date.now();
    const agent = new HttpsProxyAgent(proxy);
    const response = await axios.get('https://api.ipify.org', { httpsAgent: agent, timeout: 5000 });
    const latency = Date.now() - start;
    if (latency > 3000) {
      logger.warn(`代理 ${proxy} 延迟过高: ${latency}ms`);
      return false;
    }
    logger.info(`代理 ${proxy} 有效，IP: ${response.data}, 延迟: ${latency}ms`);
    return true;
  } catch (error) {
    logger.warn(`代理 ${proxy} 无效: ${error.message}`);
    return false;
  }
};

const setupProvider = async (proxy = null, maxRetries = 3) => {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    for (const rpcUrl of networkConfig.rpcUrls) {
      try {
        const providerOptions = {
          chainId: networkConfig.chainId,
          name: networkConfig.name,
        };
        const fetchOptions = {
          timeout: 60000, // 60 seconds
          keepAlive: true,
        };
        if (proxy && (await validateProxy(proxy))) {
          fetchOptions.agent = new HttpsProxyAgent(proxy);
          logger.info(`使用代理: ${proxy} 和 RPC: ${rpcUrl}`);
        } else {
          logger.info(`使用直接模式 (无代理) 和 RPC: ${rpcUrl}`);
        }
        const provider = new ethers.JsonRpcProvider(rpcUrl, providerOptions, {
          fetchOptions,
          headers: { 'User-Agent': randomUseragent.getRandom() },
        });
        await provider.getBlockNumber();
        logger.info(`成功连接到 RPC: ${rpcUrl}`);
        return provider;
      } catch (error) {
        logger.warn(`RPC ${rpcUrl} 尝试 ${attempt}/${maxRetries} 失败: ${error.message}`);
      }
    }
    await new Promise(resolve => setTimeout(resolve, 2000 * Math.pow(2, attempt)));
  }
  throw new Error('所有 RPC 端点均不可用');
};

const pairOptions = [
  { id: 1, from: 'WPHRS', to: 'USDC' },
  { id: 2, from: 'USDC', to: 'WPHRS' },
];

const checkBalanceAndApproval = async (wallet, tokenAddress, amount, decimals, spender) => {
  try {
    const tokenContract = new ethers.Contract(tokenAddress, erc20Abi, wallet);
    const balance = await tokenContract.balanceOf(wallet.address);
    const required = ethers.parseUnits(amount.toString(), decimals);

    if (balance < required) {
      logger.warn(`跳过: ${tokenDecimals[decimals] === 18 ? 'WPHRS' : 'USDC'} 余额不足: ${ethers.formatUnits(balance, decimals)} < ${amount}`);
      return false;
    }

    const allowance = await tokenContract.allowance(wallet.address, spender);
    if (allowance < required) {
      logger.step(`批准 ${amount} 代币给 ${spender}...`);
      const approveTx = await tokenContract.approve(spender, ethers.MaxUint256);
      await approveTx.wait();
      logger.success('批准完成');
    }

    return true;
  } catch (error) {
    logger.error(`余额/批准检查失败: ${error.message}\n堆栈: ${error.stack}`);
    return false;
  }
};

const getMulticallData = (pair, amount, walletAddress) => {
  try {
    const decimals = tokenDecimals[pair.from];
    const scaledAmount = ethers.parseUnits(amount.toString(), decimals);

    if (pair.from === 'WPHRS' && pair.to === 'USDC') {
      const data = ethers.AbiCoder.defaultAbiCoder().encode(
        ['address', 'address', 'uint256', 'address', 'uint256', 'uint256', 'uint256'],
        [
          tokens.WPHRS,
          tokens.USDC,
          500,
          walletAddress,
          '0x0000002386f26fc10000',
          0,
          0,
        ]
      );
      return [ethers.concat(['0x04e45aaf', data])];
    } else if (pair.from === 'USDC' && pair.to === 'WPHRS') {
      const data = ethers.AbiCoder.defaultAbiCoder().encode(
        ['address', 'address', 'uint256', 'address', 'uint256', 'uint256', 'uint256'],
        [
          tokens.USDC,
          tokens.WPHRS,
          500,
          '0x0000000000000000000000000000000000000002',
          '0x016345785d8a0000',
          '0x0007cd553d27f466',
          0,
        ]
      );
      return [ethers.concat(['0x04e45aaf', data])];
    } else {
      logger.error(`无效交易对`);
      return [];
    }
  } catch (error) {
    logger.error(`生成 multicall 数据失败: ${error.message}\n堆栈: ${error.stack}`);
    return [];
  }
};

const performSwap = async (wallet, provider, index, maxRetries = 3) => {
  let pair, amount;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      pair = pairOptions[Math.floor(Math.random() * pairOptions.length)];
      amount = pair.from === 'WPHRS' ? 0.001 : 0.1;
      logger.step(`准备第 ${index + 1} 次兑换 (尝试 ${attempt}/${maxRetries}): ${pair.from} -> ${pair.to} (${amount} ${pair.from})`);

      const decimals = tokenDecimals[pair.from];
      const tokenContract = new ethers.Contract(tokens[pair.from], erc20Abi, provider);
      const balance = await tokenContract.balanceOf(wallet.address);
      const required = ethers.parseUnits(amount.toString(), decimals);

      if (balance < required) {
        logger.warn(`跳过第 ${index + 1} 次兑换: ${pair.from} 余额不足: ${ethers.formatUnits(balance, decimals)} < ${amount}`);
        return;
      }

      if (!(await checkBalanceAndApproval(wallet, tokens[pair.from], amount, decimals, contractAddress))) {
        return;
      }

      const contract = new ethers.Contract(contractAddress, contractAbi, wallet);
      const multicallData = getMulticallData(pair, amount, wallet.address);
      if (!multicallData || multicallData.length === 0 || multicallData.some(data => !data || data === '0x')) {
        logger.error(`第 ${index + 1} 次兑换 multicall 数据无效或为空`);
        return;
      }

      const txData = contract.interface.encodeFunctionData('multicall', [
        ethers.toBigInt(Math.floor(Date.now() / 1000)),
        multicallData,
      ]);
      try {
        await provider.call({ to: contractAddress, data: txData });
        logger.info(`第 ${index + 1} 次兑换模拟交易成功`);
      } catch (error) {
        logger.error(`第 ${index + 1} 次兑换模拟交易失败: ${error.message}\n堆栈: ${error.stack}`);
        return;
      }

      const gasLimit = 219249;
      const gasPrice = await provider.getFeeData().then(feeData => feeData.gasPrice || ethers.parseUnits('1', 'gwei'));
      const tx = await contract.multicall(
        ethers.toBigInt(Math.floor(Date.now() / 1000)),
        multicallData,
        { gasLimit, gasPrice }
      );

      logger.loading(`第 ${index + 1} 次兑换交易已发送，等待确认...`);
      const receipt = await tx.wait();
      logger.success(`第 ${index + 1} 次兑换完成: ${receipt.hash}`);
      return;
    } catch (error) {
      logger.error(`第 ${index + 1} 次兑换失败 (尝试 ${attempt}/${maxRetries}, ${pair?.from} -> ${pair?.to}, ${amount} ${pair?.from}): ${error.message}\n堆栈: ${error.stack}`);
      if (attempt === maxRetries) {
        logger.error(`第 ${index + 1} 次兑换失败，已达最大重试次数`);
        return;
      }
      await new Promise(resolve => setTimeout(resolve, 2000 * Math.pow(2, attempt)));
    }
  }
};

const transferPHRS = async (wallet, provider, index, maxRetries = 3) => {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const amount = 0.000001;
      const randomWallet = ethers.Wallet.createRandom();
      const toAddress = randomWallet.address;
      logger.step(`准备第 ${index + 1} 次转账 (尝试 ${attempt}/${maxRetries}): ${amount} PHRS 到 ${toAddress}`);

      const balance = await provider.getBalance(wallet.address);
      const required = ethers.parseEther(amount.toString());

      if (balance < required) {
        logger.warn(`跳过第 ${index + 1} 次转账: PHRS 余额不足: ${ethers.formatEther(balance)} < ${amount}`);
        return;
      }

      const gasPrice = await provider.getFeeData().then(feeData => feeData.gasPrice || ethers.parseUnits('1', 'gwei'));
      const tx = await wallet.sendTransaction({
        to: toAddress,
        value: required,
        gasLimit: 21000,
        gasPrice,
      });

      logger.loading(`第 ${index + 1} 次转账交易已发送，等待确认...`);
      const receipt = await tx.wait();
      logger.success(`第 ${index + 1} 次转账完成: ${receipt.hash}`);
      return;
    } catch (error) {
      logger.error(`第 ${index + 1} 次转账失败 (尝试 ${attempt}/${maxRetries}): ${error.message}\n堆栈: ${error.stack}`);
      if (attempt === maxRetries) {
        logger.error(`第 ${index + 1} 次转账失败，已达最大重试次数`);
        return;
      }
      await new Promise(resolve => setTimeout(resolve, 2000 * Math.pow(2, attempt)));
    }
  }
};

const claimFaucet = async (wallet, proxy = null, maxRetries = 3) => {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      logger.step(`检查钱包 ${wallet.address} 的水龙头资格 (尝试 ${attempt}/${maxRetries})`);

      const message = "pharos";
      const signature = await wallet.signMessage(message);
      logger.step(`已签名消息: ${signature}`);

      const loginUrl = `https://api.pharosnetwork.xyz/user/login?address=${wallet.address}&signature=${signature}&invite_code=WrUoKC67VPYkdQmX`;
      const headers = {
        accept: "application/json, text/plain, */*",
        "accept-language": "en-US,en;q=0.8",
        authorization: "Bearer null",
        "sec-ch-ua": '"Chromium";v="136", "Brave";v="136", "Not.A/Brand";v="99"',
        "sec-ch-ua-mobile": "?0",
        "sec-ch-ua-platform": '"Windows"',
        "sec-fetch-dest": "empty",
        "sec-fetch-mode": "cors",
        "sec-fetch-site": "same-site",
        "sec-gpc": "1",
        Referer: "https://testnet.pharosnetwork.xyz/",
        "Referrer-Policy": "strict-origin-when-cross-origin",
        "User-Agent": randomUseragent.getRandom(),
      };

      const axiosConfig = {
        method: 'post',
        url: loginUrl,
        headers,
        httpsAgent: proxy ? new HttpsProxyAgent(proxy) : null,
        timeout: 60000, // 60 seconds
      };

      logger.loading('发送水龙头登录请求...');
      const loginResponse = await axios(axiosConfig);
      const loginData = loginResponse.data;

      if (loginData.code !== 0 || !loginData.data.jwt) {
        logger.error(`水龙头登录失败: ${JSON.stringify(loginData)}`);
        return false;
      }

      const jwt = loginData.data.jwt;
      logger.success(`水龙头登录成功，JWT: ${jwt}`);

      const statusUrl = `https://api.pharosnetwork.xyz/faucet/status?address=${wallet.address}`;
      const statusHeaders = { ...headers, authorization: `Bearer ${jwt}` };

      logger.loading('检查水龙头状态...');
      const statusResponse = await axios({
        method: 'get',
        url: statusUrl,
        headers: statusHeaders,
        httpsAgent: proxy ? new HttpsProxyAgent(proxy) : null,
        timeout: 60000,
      });
      const statusData = statusResponse.data;

      if (statusData.code !== 0 || !statusData.data) {
        logger.error(`水龙头状态检查失败: ${JSON.stringify(statusData)}`);
        return false;
      }

      if (!statusData.data.is_able_to_faucet) {
        const nextAvailable = new Date(statusData.data.avaliable_timestamp * 1000).toLocaleString('zh-CN', { timeZone: 'Asia/Makassar' });
        logger.warn(`水龙头不可用，直到: ${nextAvailable}`);
        return false;
      }

      const claimUrl = `https://api.pharosnetwork.xyz/faucet/daily?address=${wallet.address}`;
      logger.loading('领取水龙头...');
      const claimResponse = await axios({
        method: 'post',
        url: claimUrl,
        headers: statusHeaders,
        httpsAgent: proxy ? new HttpsProxyAgent(proxy) : null,
        timeout: 60000,
      });
      const claimData = claimResponse.data;

      if (claimData.code === 0) {
        logger.success(`水龙头领取成功: ${wallet.address}`);
        return true;
      } else {
        logger.error(`水龙头领取失败: ${JSON.stringify(claimData)}`);
        return false;
      }
    } catch (error) {
      logger.error(`水龙头领取失败 (尝试 ${attempt}/${maxRetries}): ${error.message}\n堆栈: ${error.stack}`);
      if (attempt === maxRetries) {
        logger.error(`水龙头领取失败，已达最大重试次数`);
        return false;
      }
      await new Promise(resolve => setTimeout(resolve, 2000 * Math.pow(2, attempt)));
    }
  }
};

const performCheckIn = async (wallet, proxy = null, maxRetries = 3) => {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      logger.step(`为钱包 ${wallet.address} 执行每日签到 (尝试 ${attempt}/${maxRetries})`);

      const message = "pharos";
      const signature = await wallet.signMessage(message);
      logger.step(`已签名消息: ${signature}`);

      const loginUrl = `https://api.pharosnetwork.xyz/user/login?address=${wallet.address}&signature=${signature}&invite_code=WrUoKC67VPYkdQmX`;
      const headers = {
        accept: "application/json, text/plain, */*",
        "accept-language": "en-US,en;q=0.8",
        authorization: "Bearer null",
        "sec-ch-ua": '"Chromium";v="136", "Brave";v="136", "Not.A/Brand";v="99"',
        "sec-ch-ua-mobile": "?0",
        "sec-ch-ua-platform": '"Windows"',
        "sec-fetch-dest": "empty",
        "sec-fetch-mode": "cors",
        "sec-fetch-site": "same-site",
        "sec-gpc": "1",
        Referer: "https://testnet.pharosnetwork.xyz/",
        "Referrer-Policy": "strict-origin-when-cross-origin",
        "User-Agent": randomUseragent.getRandom(),
      };

      const axiosConfig = {
        method: 'post',
        url: loginUrl,
        headers,
        httpsAgent: proxy ? new HttpsProxyAgent(proxy) : null,
        timeout: 60000,
      };

      logger.loading('发送签到登录请求...');
      const loginResponse = await axios(axiosConfig);
      const loginData = loginResponse.data;

      if (loginData.code !== 0 || !loginData.data.jwt) {
        logger.error(`签到登录失败: ${JSON.stringify(loginData)}`);
        return false;
      }

      const jwt = loginData.data.jwt;
      logger.success(`签到登录成功，JWT: ${jwt}`);

      const checkInUrl = `https://api.pharosnetwork.xyz/sign/in?address=${wallet.address}`;
      const checkInHeaders = { ...headers, authorization: `Bearer ${jwt}` };

      logger.loading('发送签到请求...');
      const checkInResponse = await axios({
        method: 'post',
        url: checkInUrl,
        headers: checkInHeaders,
        httpsAgent: proxy ? new HttpsProxyAgent(proxy) : null,
        timeout: 60000,
      });
      const checkInData = checkInResponse.data;

      if (checkInData.code === 0) {
        logger.success(`签到成功: ${wallet.address}`);
        return true;
      } else {
        logger.warn(`签到失败，可能已签到: ${JSON.stringify(checkInData)}`);
        return false;
      }
    } catch (error) {
      logger.error(`签到失败 (尝试 ${attempt}/${maxRetries}): ${error.message}\n堆栈: ${error.stack}`);
      if (attempt === maxRetries) {
        logger.error(`签到失败，已达最大重试次数`);
        return false;
      }
      await new Promise(resolve => setTimeout(resolve, 2000 * Math.pow(2, attempt)));
    }
  }
};

const countdown = async () => {
  const totalSeconds = 30 * 60;
  logger.info('开始30分钟倒计时...');

  for (let seconds = totalSeconds; seconds >= 0; seconds--) {
    const minutes = Math.floor(seconds / 60);
    const secs = seconds % 60;
    process.stdout.write(`\r${colors.cyan}剩余时间: ${minutes}分 ${secs}秒${colors.reset} `);
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  process.stdout.write('\r倒计时结束！重新开始...\n');
};

const processWallet = async (privateKey, proxies, walletIndex, totalWallets, batchIndex) => {
  const proxy = proxies.length ? getRandomProxy(proxies) : null;
  let provider;
  try {
    provider = await setupProvider(proxy);
  } catch (error) {
    logger.error(`无法设置提供者: ${error.message}\n堆栈: ${error.stack}`);
    return;
  }
  const wallet = new ethers.Wallet(privateKey, provider);

  logger.wallet(`第 ${batchIndex + 1} 批，处理钱包 ${walletIndex + 1}/${totalWallets}: ${wallet.address}`);

  await checkAllBalances(wallet, provider);
  await claimFaucet(wallet, proxy);
  await performCheckIn(wallet, proxy);

  for (let i = 0; i < 10; i++) {
    await transferPHRS(wallet, provider, i);
    await new Promise(resolve => setTimeout(resolve, Math.random() * 2000 + 1000));
  }

  for (let i = 0; i < 10; i++) {
    await performSwap(wallet, provider, i);
    await new Promise(resolve => setTimeout(resolve, Math.random() * 2000 + 1000));
  }
};

const main = async () => {
  const proxies = loadProxies();
  const privateKeys = Object.values(process.env)
    .filter(pk => pk && ethers.isHexString(pk, 32));
  if (!privateKeys.length) {
    logger.error('未在 .env 中找到有效的私钥。请检查 .env 文件格式');
    process.exit(1);
  }

  const batchSize = 5;
  const totalWallets = privateKeys.length;
  const totalBatches = Math.ceil(totalWallets / batchSize);

  logger.info(`共加载 ${totalWallets} 个钱包，将分 ${totalBatches} 批处理，每批 ${batchSize} 个`);

  while (true) {
    try {
      for (let batchIndex = 0; batchIndex < totalBatches; batchIndex++) {
        const startIndex = batchIndex * batchSize;
        const batchKeys = privateKeys.slice(startIndex, startIndex + batchSize);

        logger.info(`开始处理第 ${batchIndex + 1}/${totalBatches} 批，共 ${batchKeys.length} 个钱包`);

        const walletPromises = batchKeys.map(async (pk, index) => {
          await new Promise(resolve => setTimeout(resolve, (index + 1) * 10000)); // Staggered delay
          return processWallet(pk, proxies, startIndex + index, totalWallets, batchIndex);
        });
        await Promise.all(walletPromises);

        logger.success(`第 ${batchIndex + 1} 批处理完成`);
        await new Promise(resolve => setTimeout(resolve, 5000)); // Delay between batches
      }

      logger.success('所有钱包操作完成！');
      await countdown();
    } catch (error) {
      logger.error(`主循环错误: ${error.message}\n堆栈: ${error.stack}`);
      logger.error(`继续下一次循环...`);
      await new Promise(resolve => setTimeout(resolve, 5000));
    }
  }
};

main().catch(error => {
  logger.error(`机器人运行失败: ${error.message}`);
  logger.error(`错误详情: ${JSON.stringify(error, null, 2)}`);
  process.exit(1);
});