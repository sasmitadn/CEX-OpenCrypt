<?php

namespace App\Exceptions;

use Exception;

class InvalidFinancialStateException extends Exception
{
    public function __construct(string $message = "Operasi ditolak karena inkonsistensi state transaksi atau wallet terkunci.")
    {
        parent::__construct($message, 409);
    }
}
