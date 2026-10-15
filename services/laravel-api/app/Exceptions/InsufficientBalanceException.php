<?php

namespace App\Exceptions;

use Exception;

class InsufficientBalanceException extends Exception
{
    public function __construct(string $message = "Saldo akun tidak mencukupi untuk transaksi ini.")
    {
        parent::__construct($message, 422);
    }
}
