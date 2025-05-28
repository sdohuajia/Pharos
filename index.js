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
  user: (msg) => console.log(`\n${colors.white}[➤] ${msg}${colors.reset}`),
  banner: () => {
    console.log(`${colors.cyan}${colors.bold}Pharos Bot${colors.reset}\n`);
  },
};

const networkConfig = {
  name: 'Pharos 测试网',
  chainId: 688688,
  rpcUrl: 'https://testnet.dplabs-internal.com',
  currencySymbol: 'PHRS',
};

const tokens = {
  USDC: '0xad902cf99c2de2f1ba5ec4d642fd7e49cae9ee37',
  WPHRS: '0x76aaada469d23216be5f7c596fa25f282ff9b364',
  USDT: '0xed59de2d7ad9c043442e381231ee3646fc3c2939',
  POSITION_MANAGER: '0xF8a1D4FF0f9b9Af7CE58E1fc1833688F3BFd6115',
};

const poolAddresses = {
  USDC_WPHRS: '0x0373a059321219745aee4fad8a942cf088be3d0e',
  USDT_WPHRS: '0x70118b6eec45329e0534d849bc3e588bb6752527',
};

const contractAddress = '0x1a4de519154ae51200b0ad7c90f7fac75547888a';

const tokenDecimals = {
  WPHRS: 18,
  USDC: 6,
  USDT: 6,
};

const contractAbi = [
  {
    inputs: [
      { internalType: 'uint256', name: 'collectionAndSelfcalls', type: 'uint256' },
      { internalType: 'bytes[]', name: 'data', type: 'bytes[]' },
    ],
    name: 'multicall',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
];

const erc20Abi = [
  'function balanceOf(address) view returns (uint256)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function approve(address spender, uint256 amount) public returns (bool)',
  'function decimals() view returns (uint8)',
  'function deposit() public payable',
  'function withdraw(uint256 wad) public',
];

const positionManagerAbi = [
  {
    inputs: [
      {
        components: [
          { internalType: 'address', name: 'token0', type: 'address' },
          { internalType: 'address', name: 'token1', type: 'address' },
          { internalType: 'uint24', name: 'fee', type: 'uint24' },
          { internalType: 'int24', name: 'tickLower', type: 'int24' },
          { internalType: 'int24', name: 'tickUpper', type: 'int24' },
          { internalType: 'uint256', name: 'amount0Desired', type: 'uint256' },
          { internalType: 'uint256', name: 'amount1Desired', type: 'uint256' },
          { internalType: 'uint256', name: 'amount0Min', type: 'uint256' },
          { internalType: 'uint256', name: 'amount1Min', type: 'uint256' },
          { internalType: 'address', name: 'recipient', type: 'address' },
          { internalType: 'uint256', name: 'deadline', type: 'uint256' },
        ],
        internalType: 'struct INonfungiblePositionManager.MintParams',
        name: 'params',
        type: 'tuple',
      },
    ],
    name: 'mint',
    outputs: [
      { internalType: 'uint256', name: 'tokenId', type: 'uint256' },
      { internalType: 'uint128', name: 'liquidity', type: 'uint128' },
      { internalType: 'uint256', name: 'amount0', type: 'uint256' },
      { internalType: 'uint256', name: 'amount1', type: 'uint256' },
    ],
    stateMutability: 'payable',
    type: 'function',
  },
];

const pairOptions = [
  { id: 1, from: 'WPHRS', to: 'USDC', amount: 0.0001 },
  { id: 2, from: 'WPHRS', to: 'USDT', amount: 0.0001 },
  { id: 3, from: 'USDC', to: 'WPHRS', amount: 0.0001 },
  { id: 4, from: 'USDT', to: 'WPHRS', amount: 0.0001 },
  { id: 5, from: 'USDC', to: 'USDT', amount: 0.0001 },
  { id: 6, from: 'USDT', to: 'USDC', amount: 0.0001 },
];

const lpOptions = [
  { id: 1, token0: 'WPHRS', token1: 'USDC', amount0: 0.0001, amount1: 0.0001, fee: 3000 },
  { id: 2, token0: 'WPHRS', token1: 'USDT', amount0: 0.0001, amount1: 0.0001, fee: 3000 },
];

const loadProxies = () => {
  try {
    const proxies = fs.readFileSync('proxies.txt', 'utf8')
      .split('\n')
      .map(line => line.trim())
      .filter(line => line);
    return proxies;
  } catch (error) {
    logger.warn('未找到proxies.txt或加载失败，切换到直接模式');
    return [];
  }
};

const getRandomProxy = (proxies) => {
  return proxies[Math.floor(Math.random() * proxies.length)];
};

const setupProvider = (proxy = null) => {
  if (proxy) {
    logger.info(`使用代理: ${proxy}`);
    const agent = new HttpsProxyAgent(proxy);
    return new ethers.JsonRpcProvider(networkConfig.rpcUrl, {
      chainId: networkConfig.chainId,
      name: networkConfig.name,
    }, {
      fetchOptions: { agent },
      headers: { 'User-Agent': randomUseragent.getRandom() },
    });
  } else {
    logger.info('使用直接模式（无代理）');
    return new ethers.JsonRpcProvider(networkConfig.rpcUrl, {
      chainId: networkConfig.chainId,
      name: networkConfig.name,
    });
  }
};

const waitForTransactionWithRetry = async (provider, txHash, maxRetries = 5, baseDelayMs = 1000) => {
  let retries = 0;
  while (retries < maxRetries) {
    try {
      const receipt = await provider.getTransactionReceipt(txHash);
      if (receipt) {
        return receipt;
      }
      logger.warn(`未找到交易收据 ${txHash}，重试 (${retries + 1}/${maxRetries})...`);
      await new Promise(resolve => setTimeout(resolve, baseDelayMs * Math.pow(2, retries)));
      retries++;
    } catch (error) {
      logger.error(`获取交易收据 ${txHash} 失败: ${error.message}`);
      if (error.code === -32008) {
        logger.warn(`RPC错误 -32008，重试 (${retries + 1}/${maxRetries})...`);
        await new Promise(resolve => setTimeout(resolve, baseDelayMs * Math.pow(2, retries)));
        retries++;
      } else {
        throw error;
      }
    }
  }
  throw new Error(`在 ${maxRetries} 次重试后未能获取交易收据 ${txHash}`);
};

const checkBalanceAndApproval = async (wallet, tokenAddress, amount, decimals, spender) => {
  try {
    const tokenContract = new ethers.Contract(tokenAddress, erc20Abi, wallet);
    const balance = await tokenContract.balanceOf(wallet.address);
    const required = ethers.parseUnits(amount.toString(), decimals);

    if (balance < required) {
      logger.warn(
        `跳过: ${Object.keys(tokenDecimals).find(
          key => tokenDecimals[key] === decimals
        )} 余额不足: ${ethers.formatUnits(balance, decimals)} < ${amount}`
      );
      return false;
    }

    const allowance = await tokenContract.allowance(wallet.address, spender);
    if (allowance < required) {
      logger.step(`为 ${spender} 批准 ${amount} 个代币...`);
      const estimatedGas = await tokenContract.approve.estimateGas(spender, ethers.MaxUint256);
      const feeData = await wallet.provider.getFeeData();
      const gasPrice = feeData.gasPrice || ethers.parseUnits('1', 'gwei');
      const approveTx = await tokenContract.approve(spender, ethers.MaxUint256, {
        gasLimit: Math.ceil(Number(estimatedGas) * 1.2),
        gasPrice,
        maxFeePerGas: feeData.maxFeePerGas || undefined,
        maxPriorityFeePerGas: feeData.maxPriorityFeePerGas || undefined,
      });
      const receipt = await waitForTransactionWithRetry(wallet.provider, approveTx.hash);
      logger.success('批准完成');
    }

    return true;
  } catch (error) {
    logger.error(`余额/批准检查失败: ${error.message}`);
    return false;
  }
};

const getUserInfo = async (wallet, proxy = null, jwt) => {
  try {
    logger.user(`为钱包 ${wallet.address} 获取用户信息`);
    const profileUrl = `https://api.pharosnetwork.xyz/user/profile?address=${wallet.address}`;
    const headers = {
      accept: "application/json, text/plain, */*",
      "accept-language": "en-US,en;q=0.8",
      authorization: `Bearer ${jwt}`,
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
      method: 'get',
      url: profileUrl,
      headers,
      httpsAgent: proxy ? new HttpsProxyAgent(proxy) : null,
    };

    logger.loading('正在获取用户资料...');
    const response = await axios(axiosConfig);
    const data = response.data;

    if (data.code !== 0 || !data.data.user_info) {
      logger.error(`获取用户信息失败: ${data.msg || '未知错误'}`);
      return;
    }

    const userInfo = data.data.user_info;
    logger.info(`用户ID: ${userInfo.ID}`);
    logger.info(`任务积分: ${userInfo.TaskPoints}`);
    logger.info(`总积分: ${userInfo.TotalPoints}`);
  } catch (error) {
    logger.error(`获取用户信息失败: ${error.message}`);
  }
};

const verifyTask = async (wallet, proxy, jwt, txHash) => {
  try {
    logger.step(`为交易 ${txHash} 验证任务ID 103`);
    const verifyUrl = `https://api.pharosnetwork.xyz/task/verify?address=${wallet.address}&task_id=103&tx_hash=${txHash}`;
    
    const headers = {
      accept: "application/json, text/plain, */*",
      "accept-language": "en-US,en;q=0.8",
      authorization: `Bearer ${jwt}`,
      priority: "u=1, i",
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
      url: verifyUrl,
      headers,
      httpsAgent: proxy ? new HttpsProxyAgent(proxy) : null,
    };

    logger.loading('正在发送任务验证请求...');
    const response = await axios(axiosConfig);
    const data = response.data;

    if (data.code === 0 && data.data.verified) {
      logger.success(`任务ID 103 为 ${txHash} 验证成功`);
      return true;
    } else {
      logger.warn(`任务验证失败: ${data.msg || '未知错误'}`);
      return false;
    }
  } catch (error) {
    logger.error(`任务验证失败 ${txHash}: ${error.message}`);
    return false;
  }
};

const getMulticallData = (pair, amount, walletAddress) => {
  try {
    const decimals = tokenDecimals[pair.from];
    const scaledAmount = ethers.parseUnits(amount.toString(), decimals);

    const data = ethers.AbiCoder.defaultAbiCoder().encode(
      ['address', 'address', 'uint256', 'address', 'uint256', 'uint256', 'uint256'],
      [
        tokens[pair.from],
        tokens[pair.to],
        500,
        walletAddress,
        scaledAmount,
        0,
        0,
      ]
    );

    return [ethers.concat(['0x04e45aaf', data])];
  } catch (error) {
    logger.error(`生成多重调用数据失败: ${error.message}`);
    return [];
  }
};

const performSwap = async (wallet, provider, index, jwt, proxy) => {
  try {
    const pair = pairOptions[Math.floor(Math.random() * pairOptions.length)];
    const amount = pair.amount;
    logger.step(
      `准备第 ${index + 1} 次兑换: ${pair.from} -> ${pair.to} (${amount} ${pair.from})`
    );

    const decimals = tokenDecimals[pair.from];
    const tokenContract = new ethers.Contract(tokens[pair.from], erc20Abi, provider);
    const balance = await tokenContract.balanceOf(wallet.address);
    const required = ethers.parseUnits(amount.toString(), decimals);

    if (balance < required) {
      logger.warn(
        `跳过第 ${index + 1} 次兑换: ${pair.from} 余额不足: ${ethers.formatUnits(
          balance,
          decimals
        )} < ${amount}`
      );
      return;
    }

    if (!(await checkBalanceAndApproval(wallet, tokens[pair.from], amount, decimals, contractAddress))) {
      return;
    }

    const contract = new ethers.Contract(contractAddress, contractAbi, wallet);
    const multicallData = getMulticallData(pair, amount, wallet.address);

    if (!multicallData || multicallData.length === 0 || multicallData.some(data => !data || data === '0x')) {
      logger.error(`无效或空的多重调用数据 ${pair.from} -> ${pair.to}`);
      return;
    }

    const deadline = Math.floor(Date.now() / 1000) + 300;
    let estimatedGas;
    try {
      estimatedGas = await contract.multicall.estimateGas(deadline, multicallData, {
        from: wallet.address,
      });
    } catch (error) {
      logger.error(`第 ${index + 1} 次兑换估算燃气失败: ${error.message}`);
      return;
    }

    const feeData = await provider.getFeeData();
    const gasPrice = feeData.gasPrice || ethers.parseUnits('1', 'gwei');
    const tx = await contract.multicall(deadline, multicallData, {
      gasLimit: Math.ceil(Number(estimatedGas) * 1.2),
      gasPrice,
      maxFeePerGas: feeData.maxFeePerGas || undefined,
      maxPriorityFeePerGas: feeData.maxPriorityFeePerGas || undefined,
    });

    logger.loading(`第 ${index + 1} 次兑换交易已发送，等待确认...`);
    const receipt = await waitForTransactionWithRetry(provider, tx.hash);
    logger.success(`第 ${index + 1} 次兑换完成: ${receipt.hash}`);
    logger.step(`浏览器: https://testnet.pharosscan.xyz/tx/${receipt.hash}`);

    await verifyTask(wallet, proxy, jwt, receipt.hash);
  } catch (error) {
    logger.error(`第 ${index + 1} 次兑换失败: ${error.message}`);
    if (error.transaction) {
      logger.error(`交易详情: ${JSON.stringify(error.transaction, null, 2)}`);
    }
    if (error.receipt) {
      logger.error(`收据: ${JSON.stringify(error.receipt, null, 2)}`);
    }
  }
};

const transferPHRS = async (wallet, provider, index, jwt, proxy) => {
  try {
    const amount = 0.000001;
    const randomWallet = ethers.Wallet.createRandom();
    const toAddress = randomWallet.address;
    logger.step(`准备第 ${index + 1} 次 PHRS 转账: ${amount} PHRS 到 ${toAddress}`);

    const balance = await provider.getBalance(wallet.address);
    const required = ethers.parseEther(amount.toString());

    if (balance < required) {
      logger.warn(`跳过第 ${index + 1} 次转账: PHRS 余额不足: ${ethers.formatEther(balance)} < ${amount}`);
      return;
    }

    const feeData = await provider.getFeeData();
    const gasPrice = feeData.gasPrice || ethers.parseUnits('1', 'gwei');
    const tx = await wallet.sendTransaction({
      to: toAddress,
      value: required,
      gasLimit: 21000,
      gasPrice,
      maxFeePerGas: feeData.maxFeePerGas || undefined,
      maxPriorityFeePerGas: feeData.maxPriorityFeePerGas || undefined,
    });

    logger.loading(`第 ${index + 1} 次转账交易已发送，等待确认...`);
    const receipt = await waitForTransactionWithRetry(provider, tx.hash);
    logger.success(`第 ${index + 1} 次转账完成: ${receipt.hash}`);
    logger.step(`浏览器: https://testnet.pharosscan.xyz/tx/${receipt.hash}`);

    await verifyTask(wallet, proxy, jwt, receipt.hash);
  } catch (error) {
    logger.error(`第 ${index + 1} 次转账失败: ${error.message}`);
    if (error.transaction) {
      logger.error(`交易详情: ${JSON.stringify(error.transaction, null, 2)}`);
    }
    if (error.receipt) {
      logger.error(`收据: ${JSON.stringify(error.receipt, null, 2)}`);
    }
  }
};

const wrapPHRS = async (wallet, provider, index, jwt, proxy) => {
  try {
    const minAmount = 0.001;
    const maxAmount = 0.005;
    const amount = minAmount + Math.random() * (maxAmount - minAmount);
    const amountWei = ethers.parseEther(amount.toFixed(6).toString());
    logger.step(`准备第 ${index + 1} 次包装 PHRS: ${amount.toFixed(6)} PHRS 到 WPHRS`);

    const balance = await provider.getBalance(wallet.address);
    if (balance < amountWei) {
      logger.warn(`跳过第 ${index + 1} 次包装: PHRS 余额不足: ${ethers.formatEther(balance)} < ${amount.toFixed(6)}`);
      return;
    }

    const wphrsContract = new ethers.Contract(tokens.WPHRS, erc20Abi, wallet);
    let estimatedGas;
    try {
      estimatedGas = await wphrsContract.deposit.estimateGas({ value: amountWei });
    } catch (error) {
      logger.error(`第 ${index + 1} 次包装估算燃气失败: ${error.message}`);
      return;
    }

    const feeData = await provider.getFeeData();
    const gasPrice = feeData.gasPrice || ethers.parseUnits('1', 'gwei');
    const tx = await wphrsContract.deposit({
      value: amountWei,
      gasLimit: Math.ceil(Number(estimatedGas) * 1.2),
      gasPrice,
      maxFeePerGas: feeData.maxFeePerGas || undefined,
      maxPriorityFeePerGas: feeData.maxPriorityFeePerGas || undefined,
    });

    logger.loading(`第 ${index + 1} 次包装交易已发送，等待确认...`);
    const receipt = await waitForTransactionWithRetry(provider, tx.hash);
    logger.success(`第 ${index + 1} 次包装完成: ${receipt.hash}`);
    logger.step(`浏览器: https://testnet.pharosscan.xyz/tx/${receipt.hash}`);

    await verifyTask(wallet, proxy, jwt, receipt.hash);
  } catch (error) {
    logger.error(`第 ${index + 1} 次包装失败: ${error.message}`);
    if (error.transaction) {
      logger.error(`交易详情: ${JSON.stringify(error.transaction, null, 2)}`);
    }
    if (error.receipt) {
      logger.error(`收据: ${JSON.stringify(error.receipt, null, 2)}`);
    }
  }
};

const claimFaucet = async (wallet, proxy = null) => {
  try {
    logger.step(`检查钱包 ${wallet.address} 的水龙头资格`);

    const message = "pharos";
    const signature = await wallet.signMessage(message);
    logger.step(`签名消息: ${signature}`);

    const loginUrl = `https://api.pharosnetwork.xyz/user/login?address=${wallet.address}&signature=${signature}&invite_code=S6NGMzXSCDBxhnwo`;
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
    };

    logger.loading('正在发送水龙头登录请求...');
    const loginResponse = await axios(axiosConfig);
    const loginData = loginResponse.data;

    if (loginData.code !== 0 || !loginData.data.jwt) {
      logger.error(`水龙头登录失败: ${loginData.msg || '未知错误'}`);
      return false;
    }

    const jwt = loginData.data.jwt;
    logger.success(`水龙头登录成功，JWT: ${jwt}`);

    const statusUrl = `https://api.pharosnetwork.xyz/faucet/status?address=${wallet.address}`;
    const statusHeaders = {
      ...headers,
      authorization: `Bearer ${jwt}`,
    };

    logger.loading('正在检查水龙头状态...');
    const statusResponse = await axios({
      method: 'get',
      url: statusUrl,
      headers: statusHeaders,
      httpsAgent: proxy ? new HttpsProxyAgent(proxy) : null,
    });
    const statusData = statusResponse.data;

    if (statusData.code !== 0 || !statusData.data) {
      logger.error(`水龙头状态检查失败: ${statusData.msg || '未知错误'}`);
      return false;
    }

    if (!statusData.data.is_able_to_faucet) {
      const nextAvailable = new Date(statusData.data.avaliable_timestamp * 1000).toLocaleString('zh-CN', { timeZone: 'Asia/Makassar' });
      logger.warn(`水龙头不可用，直到: ${nextAvailable}`);
      return false;
    }

    const claimUrl = `https://api.pharosnetwork.xyz/faucet/daily?address=${wallet.address}`;
    logger.loading('正在领取水龙头...');
    const claimResponse = await axios({
      method: 'post',
      url: claimUrl,
      headers: statusHeaders,
      httpsAgent: proxy ? new HttpsProxyAgent(proxy) : null,
    });
    const claimData = claimResponse.data;

    if (claimData.code === 0) {
      logger.success(`为 ${wallet.address} 成功领取水龙头`);
      return true;
    } else {
      logger.error(`水龙头领取失败: ${claimData.msg || '未知错误'}`);
      return false;
    }
  } catch (error) {
    logger.error(`为 ${wallet.address} 领取水龙头失败: ${error.message}`);
    return false;
  }
};

const performCheckIn = async (wallet, proxy = null) => {
  try {
    logger.step(`为钱包 ${wallet.address} 执行每日签到`);

    const message = "pharos";
    const signature = await wallet.signMessage(message);
    logger.step(`签名消息: ${signature}`);

    const loginUrl = `https://api.pharosnetwork.xyz/user/login?address=${wallet.address}&signature=${signature}&invite_code=S6NGMzXSCDBxhnwo`;
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
    };

    logger.loading('正在发送登录请求...');
    const loginResponse = await axios(axiosConfig);
    const loginData = loginResponse.data;

    if (loginData.code !== 0 || !loginData.data.jwt) {
      logger.error(`登录失败: ${loginData.msg || '未知错误'}`);
      return null;
    }

    const jwt = loginData.data.jwt;
    logger.success(`登录成功，JWT: ${jwt}`);

    const checkInUrl = `https://api.pharosnetwork.xyz/sign/in?address=${wallet.address}`;
    const checkInHeaders = {
      ...headers,
      authorization: `Bearer ${jwt}`,
    };

    logger.loading('正在发送签到请求...');
    const checkInResponse = await axios({
      method: 'post',
      url: checkInUrl,
      headers: checkInHeaders,
      httpsAgent: proxy ? new HttpsProxyAgent(proxy) : null,
    });
    const checkInData = checkInResponse.data;

    if (checkInData.code === 0) {
      logger.success(`为 ${wallet.address} 签到成功`);
      return jwt;
    } else {
      logger.warn(`签到失败，可能已签到: ${checkInData.msg || '未知错误'}`);
      return jwt;
    }
  } catch (error) {
    logger.error(`为 ${wallet.address} 签到失败: ${error.message}`);
    return null;
  }
};

const addLiquidity = async (wallet, provider, index, jwt, proxy) => {
  try {
    const pair = lpOptions[Math.floor(Math.random() * lpOptions.length)];
    const amount0 = pair.amount0;
    const amount1 = pair.amount1;
    logger.step(
      `准备第 ${index + 1} 次添加流动性: ${pair.token0}/${pair.token1} (${amount0} ${pair.token0}, ${amount1} ${pair.token1})`
    );

    const decimals0 = tokenDecimals[pair.token0];
    const amount0Wei = ethers.parseUnits(amount0.toString(), decimals0);
    if (!(await checkBalanceAndApproval(wallet, tokens[pair.token0], amount0, decimals0, tokens.POSITION_MANAGER))) {
      return;
    }

    const decimals1 = tokenDecimals[pair.token1];
    const amount1Wei = ethers.parseUnits(amount1.toString(), decimals1);
    if (!(await checkBalanceAndApproval(wallet, tokens[pair.token1], amount1, decimals1, tokens.POSITION_MANAGER))) {
      return;
    }

    const positionManager = new ethers.Contract(tokens.POSITION_MANAGER, positionManagerAbi, wallet);

    const deadline = Math.floor(Date.now() / 1000) + 600;
    const tickLower = -60000;
    const tickUpper = 60000;

    const mintParams = {
      token0: tokens[pair.token0],
      token1: tokens[pair.token1],
      fee: pair.fee,
      tickLower,
      tickUpper,
      amount0Desired: amount0Wei,
      amount1Desired: amount1Wei,
      amount0Min: 0,
      amount1Min: 0,
      recipient: wallet.address,
      deadline,
    };

    let estimatedGas;
    try {
      estimatedGas = await positionManager.mint.estimateGas(mintParams, { from: wallet.address });
    } catch (error) {
      logger.error(`第 ${index + 1} 次流动性添加估算燃气失败: ${error.message}`);
      return;
    }

    const feeData = await provider.getFeeData();
    const gasPrice = feeData.gasPrice || ethers.parseUnits('1', 'gwei');

    const tx = await positionManager.mint(mintParams, {
      gasLimit: Math.ceil(Number(estimatedGas) * 1.2),
      gasPrice,
      maxFeePerGas: feeData.maxFeePerGas || undefined,
      maxPriorityFeePerGas: feeData.maxPriorityFeePerGas || undefined,
    });

    logger.loading(`第 ${index + 1} 次流动性添加已发送，等待确认...`);
    const receipt = await waitForTransactionWithRetry(provider, tx.hash);
    logger.success(`第 ${index + 1} 次流动性添加完成: ${receipt.hash}`);
    logger.step(`浏览器: https://testnet.pharosscan.xyz/tx/${receipt.hash}`);

    await verifyTask(wallet, proxy, jwt, receipt.hash);
  } catch (error) {
    logger.error(`第 ${index + 1} 次流动性添加失败: ${error.message}`);
    if (error.transaction) {
      logger.error(`交易详情: ${JSON.stringify(error.transaction, null, 2)}`);
    }
    if (error.receipt) {
      logger.error(`收据: ${JSON.stringify(error.receipt, null, 2)}`);
    }
  }
};

const countdown = async (minutes) => {
  const totalSeconds = minutes * 60;
  logger.info(`开始 ${minutes} 分钟倒计时...`);

  for (let seconds = totalSeconds; seconds >= 0; seconds--) {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    process.stdout.write(`\r${colors.cyan}剩余时间: ${mins}分 ${secs}秒${colors.reset} `);
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  process.stdout.write('\r倒计时完成！重新开始进程...\n');
};

const processWallet = async (privateKey, proxies, index) => {
  const proxy = proxies.length ? getRandomProxy(proxies) : null;
  const provider = setupProvider(proxy);
  const wallet = new ethers.Wallet(privateKey, provider);

  logger.wallet(`使用钱包 ${index + 1}: ${wallet.address}`);

  await claimFaucet(wallet, proxy);

  const jwt = await performCheckIn(wallet, proxy);
  if (jwt) {
    await getUserInfo(wallet, proxy, jwt);
  } else {
    logger.error('由于签到失败，跳过用户信息获取');
  }

  const numTransfers = 10;
  const numWraps = 10;
  const numSwaps = 10;
  const numLPs = 10;

  console.log(`\n${colors.cyan}------------------------${colors.reset}`);
  console.log(`${colors.cyan}转账 - 钱包 ${wallet.address}${colors.reset}`);
  console.log(`${colors.cyan}------------------------${colors.reset}`);
  for (let i = 0; i < numTransfers; i++) {
    await transferPHRS(wallet, provider, i, jwt, proxy);
    await new Promise(resolve => setTimeout(resolve, Math.random() * 2000 + 1000));
  }

  console.log(`\n${colors.cyan}------------------------${colors.reset}`);
  console.log(`${colors.cyan}包装 - 钱包 ${wallet.address}${colors.reset}`);
  console.log(`${colors.cyan}------------------------${colors.reset}`);
  for (let i = 0; i < numWraps; i++) {
    await wrapPHRS(wallet, provider, i, jwt, proxy);
    await new Promise(resolve => setTimeout(resolve, Math.random() * 2000 + 1000));
  }

  console.log(`\n${colors.cyan}------------------------${colors.reset}`);
  console.log(`${colors.cyan}兑换 - 钱包 ${wallet.address}${colors.reset}`);
  console.log(`${colors.cyan}------------------------${colors.reset}`);
  for (let i = 0; i < numSwaps; i++) {
    await performSwap(wallet, provider, i, jwt, proxy);
    await new Promise(resolve => setTimeout(resolve, Math.random() * 2000 + 1000));
  }

  console.log(`\n${colors.cyan}------------------------${colors.reset}`);
  console.log(`${colors.cyan}添加流动性 - 钱包 ${wallet.address}${colors.reset}`);
  console.log(`${colors.cyan}------------------------${colors.reset}`);
  for (let i = 0; i < numLPs; i++) {
    await addLiquidity(wallet, provider, i, jwt, proxy);
    await new Promise(resolve => setTimeout(resolve, Math.random() * 2000 + 1000));
  }
};

const main = async () => {
  logger.banner();

  const delayMinutes = 60; // 默认延迟时间为 60 分钟
  logger.info(`循环之间的延迟设置为 ${delayMinutes} 分钟`);

  const proxies = loadProxies();
  const privateKeys = [
    process.env.PRIVATE_KEY_1,
    process.env.PRIVATE_KEY_2,
    // 支持更多私钥，例如 PRIVATE_KEY_3 到 PRIVATE_KEY_30
  ].filter(pk => pk);

  if (!privateKeys.length) {
    logger.error('在 .env 中未找到私钥');
    return;
  }

  const concurrency = 3; // 每次并发处理 3 个钱包
  logger.info(`每次并发处理 ${concurrency} 个钱包`);

  while (true) {
    logger.info(`开始处理 ${privateKeys.length} 个钱包，共 ${Math.ceil(privateKeys.length / concurrency)} 轮`);

    // 分批处理钱包
    for (let i = 0; i < privateKeys.length; i += concurrency) {
      const batch = privateKeys.slice(i, i + concurrency);
      logger.info(`处理第 ${Math.floor(i / concurrency) + 1} 轮，包含 ${batch.length} 个钱包`);

      // 并发执行当前批次的钱包
      const walletPromises = batch.map((privateKey, index) =>
        processWallet(privateKey, proxies, i + index).catch(error => {
          logger.error(`钱包 ${i + index + 1} 处理失败: ${error.message}`);
        })
      );

      // 等待当前批次所有钱包完成
      await Promise.all(walletPromises);
      logger.success(`第 ${Math.floor(i / concurrency) + 1} 轮完成`);
    }

    logger.success('所有钱包的所有操作已完成！');
    await countdown(delayMinutes);
  }
};

main().catch(error => {
  logger.error(`机器人失败: ${error.message}`);
  process.exit(1);
});
