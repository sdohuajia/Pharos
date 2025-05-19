#!/bin/bash

# 输入和输出文件名
INPUT_FILE="token.txt"
OUTPUT_FILE=".env"

# 函数：读取私钥并写入 .env 文件
generate_env_file() {
    local index=1
    # 清空或创建输出文件
    > "$OUTPUT_FILE"

    # 逐行读取 token.txt
    while IFS= read -r key; do
        # 跳过空行
        [[ -z "$key" ]] && continue

        # 验证私钥格式（以 0x 开头，64 位十六进制）
        if [[ ! "$key" =~ ^0x[0-9a-fA-F]{64}$ ]]; then
            echo "错误：无效私钥格式（行 $index）：$key"
            exit 1
        fi

        # 写入 .env 文件
        echo "PRIVATE_KEY_${index}=${key}" >> "$OUTPUT_FILE"
        ((index++))
    done < "$INPUT_FILE"
}

# 主逻辑
main() {
    # 检查 token.txt 是否存在
    if [[ ! -f "$INPUT_FILE" ]]; then
        echo "错误：$INPUT_FILE 文件不存在！"
        exit 1
    fi

    # 检查 token.txt 是否为空
    if [[ ! -s "$INPUT_FILE" ]]; then
        echo "错误：$INPUT_FILE 文件为空！"
        exit 1
    fi

    # 生成 .env 文件
    generate_env_file

    # 提示完成并显示 .env 文件内容
    echo -e "\n已生成 $OUTPUT_FILE 文件，内容如下："
    cat "$OUTPUT_FILE"
}

# 运行主函数
main